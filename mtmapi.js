/*
This file is part of the Microtick-API

Microtick-API is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Microtick-API is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Microtick-API.  If not, see <http://www.gnu.org/licenses/>.
*/

var globals = {};
globals.abis = [];
globals.abis['MTM'] = '[{"constant":true,"inputs":[],"name":"creator","outputs":[{"name":"","type":"address"}],"type":"function"},{"constant":true,"inputs":[{"name":"addr","type":"address"}],"name":"isSystemContract","outputs":[{"name":"","type":"bool"}],"type":"function"},{"constant":true,"inputs":[{"name":"name","type":"bytes32"}],"name":"getABI","outputs":[{"name":"","type":"string"}],"type":"function"},{"constant":false,"inputs":[{"name":"name","type":"bytes32"},{"name":"addr","type":"address"}],"name":"addContract","outputs":[],"type":"function"},{"constant":true,"inputs":[{"name":"name","type":"bytes32"}],"name":"deployedStatus","outputs":[{"name":"","type":"uint256"}],"type":"function"},{"constant":false,"inputs":[{"name":"name","type":"bytes32"},{"name":"abi","type":"string"}],"name":"storeABI","outputs":[],"type":"function"},{"constant":false,"inputs":[{"name":"name","type":"bytes32"}],"name":"removeContract","outputs":[],"type":"function"},{"constant":false,"inputs":[],"name":"remove","outputs":[],"type":"function"},{"constant":true,"inputs":[{"name":"addr","type":"address"}],"name":"isMicrotick","outputs":[{"name":"","type":"bool"}],"type":"function"},{"constant":true,"inputs":[{"name":"name","type":"bytes32"}],"name":"getContract","outputs":[{"name":"","type":"address"}],"type":"function"},{"anonymous":false,"inputs":[{"indexed":false,"name":"id","type":"string"},{"indexed":false,"name":"name","type":"bytes32"},{"indexed":false,"name":"addr","type":"address"},{"indexed":false,"name":"block","type":"uint256"}],"name":"ComponentLifecycleEvent","type":"event"}]';
globals.create = function(name, addr) {
    if (addr == "0x") throw new Error("Can't create " + name + " at address: " + addr);
    return globals.web3.eth.contract(JSON.parse(globals.abis[name])).at(addr);
};

globals.AccountEvent = [ "---", "CRE", "DEL" ];
globals.TransactionEvent = [ "---", "DEP", "ESC", "WTH", "-PRE", "+PRE", "-COM", "+COM", "SET", "DED", "REF", "ECOM" ];
globals.ContractEvent = [ "---", "NEW", "UPD", "MATCH", "CNCL", "END" ];
globals.CommissionEvent = [ "---", "PAY", "AWD" ];

globals.LONG_AMOUNT = 2;
globals.SHORT_AMOUNT = 10;
globals.logging = false;
globals.pendingTransactions = [];
globals.onNewBlock = [];

// Black-Scholes option pricing and support
// functions

var erf = function(x) {
    // save the sign of x
    var sign = (x >= 0) ? 1 : -1;
    x = Math.abs(x);

    // constants
    var a1 =  0.254829592;
    var a2 = -0.284496736;
    var a3 =  1.421413741;
    var a4 = -1.453152027;
    var a5 =  1.061405429;
    var p  =  0.3275911;

    // A&S formula 7.1.26
    var t = 1.0/(1.0 + p*x);
    var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y; // erf(-x) = -erf(x);
}

var cdf = function(x, mean, variance) {
    return 0.5 * (1 + erf((x - mean) / (Math.sqrt(2 * variance))));
}

var ln = function(x) {
    return Math.log(x);
}

function blackscholes(spot, strike, vol, T, r) {
    // OP = S * N(d1) - X * exp(-r * t) * N(d2)
    // d1 = (ln(S/X) + (r + v^2/2) * t) / (v * sqrt(t))
    // d2 = d1 - v * sqrt(t)
    // S = spot price
    // X = strike price
    // t = time remaining, percent of a year
    // r = risk-free interest rate, continuously compounded
    // v = annual volatility (std dev of short-term returns over 1 year)
    //      square root of the mean of the squared deviations of close-close log returns
    var d1 = (ln(spot / strike) + (r + vol * vol / 2.0) * T) / (vol * Math.sqrt(T));
    var d2 = d1 - vol * Math.sqrt(T);
    var C = spot * cdf(d1, 0, 1) - strike * cdf(d2, 0, 1) * Math.exp(-r * T);
    var P = C - spot + strike * Math.exp(-r * T);
    return { call: C, put: P };
}

function approx(spot, delta, vol) {
    var ret = {
        call: [delta],
        put: [delta]
    };
    for (var i=-2;i<3; i++) {
        var obj = blackscholes(spot, spot+i*delta, vol, 1, 0);
        ret.call.push(obj.call);
        ret.put.push(obj.put);
    }
    return ret;
}

// End Black-Scholes support
    
function sync_msg() {
    console.error("Synchronous MTMAPI calls are not recommended");
    console.trace();
}

// Contract

var Contract = function(addr, api) {
    this.contract = globals.create('MTMContract', addr);
    this.addr = addr;
    this.api = api;
    this.local = [];
};

Contract.prototype.getAddress = function() {
    return this.contract.address;
};

// BEGIN CONTRACT UPDATE FUNCTIONS

Contract.prototype.getValues = function(names, cb) {
    if (cb == null) sync_msg();
    //console.log("getting values: " + names);
    if (names == null) {
        cb();
        return;
    }
    var promises = [];
    var context = this;
    for (var i=0; i<names.length; i++) {
        var func = this.funcmap[names[i]];
        if (func !== undefined) {
            promises.push(new Promise(function(resolve, reject) {
                var name = names[i];
                func.call(context, function(res) {
                    //console.log("setting " + name + " to " + res);
                    context.local[name] = res;
                    resolve();
                });
            }));
        }
    }
    Promise.all(promises).then(function() {
        cb();
    });
};

Contract.prototype.cbGetCreated = function(cb) {
    if (cb == null) sync_msg();
    this.contract.created(function(err, res) {
        cb(parseInt(res, 10));
    });
};

Contract.prototype.cbGetModified = function(cb) {
    if (cb == null) sync_msg();
    this.contract.modified(function(err, res) {
        cb(parseInt(res, 10));
    });
};

Contract.prototype.cbGetSupplier = function(cb) {
    if (cb == null) sync_msg();
    this.contract.supplier(function(err, res) {
        cb(res);
    });
};

Contract.prototype.cbGetDemander = function(cb) {
    if (cb == null) sync_msg();
    this.contract.demander(function(err, res) {
        cb(res);
    });
};

Contract.prototype.cbGetMarket = function(cb) {
    if (cb == null) sync_msg();
    this.contract.mid(function(err, res) {
        cb(globals.web3.toAscii(res).replace(/\u0000/g, ''));
    });
};

Contract.prototype.cbGetBacking = function(cb) {
    if (cb == null) sync_msg();
    this.contract.backing(function(err, res) {
        cb(globals.web3.fromWei(res));
    });
};

Contract.prototype.cbGetSpot = function(cb) {
    if (cb == null) sync_msg();
    this.contract.spot(function(err, res) {
        cb(globals.web3.fromWei(res));
    });
};

Contract.prototype.cbGetType = function(cb) {
    if (cb == null) sync_msg();
    this.contract.call_put(function(err, res) {
        cb(res);
    });
};

Contract.prototype.cbGetState = function(cb) {
    if (cb == null) sync_msg();
    this.contract.state(function(err, res) {
        cb(res);
    });
};

Contract.prototype.cbGetDuration = function(cb) {
    if (cb == null) sync_msg();
    this.contract.duration(function(err, res) {
        cb(res);
    });
};

Contract.prototype.cbGetPremium = function(cb) {
    if (cb == null) sync_msg();
    this.contract.premium(function(err, res) {
        cb(globals.web3.fromWei(res));
    });
};

Contract.prototype.cbGetQuantity = function(cb) {
    if (cb == null) sync_msg();
    this.contract.quantity(function(err, res) {
        cb(globals.web3.fromWei(res));
    });
};

Contract.prototype.cbGetStrike = function(cb) {
    if (cb == null) sync_msg();
    this.contract.strike(function(err, res) {
        cb(globals.web3.fromWei(res));
    });
};

Contract.prototype.cbGetExpiration = function(cb) {
    if (cb == null) sync_msg();
    this.contract.expiration(function(err, res) {
        cb(res);
    });
};

Contract.prototype.cbGetCallAry = function(cb) {
    if (cb == null) sync_msg();
    var callary = new Array(6);
    var context = this;
    var promises = [];
    for (var i=0; i<6; i++) {
        promises.push(new Promise(function(resolve, reject) {
            var index = i;
            context.contract.call(i, function(err, res) {
                if (!err) {
                    callary[index] = parseFloat(globals.web3.fromWei(res));
                } else {
                    callary[index] = 0;
                }
                resolve();
            });
        }));
    }
    Promise.all(promises).then(function() {
        //for (var i=0; i<6; i++) {
            //console.log("callary[" + i + "] = " + callary[i]);
        //}
        cb(callary);
    });
};

Contract.prototype.cbGetPutAry = function(cb) {
    if (cb == null) sync_msg();
    var putary = new Array(6);
    var context = this;
    var promises = [];
    for (var i=0; i<6; i++) {
        promises.push(new Promise(function(resolve, reject) {
            var index = i;
            context.contract.put(i, function(err, res) {
                if (!err) {
                    putary[index] = parseFloat(globals.web3.fromWei(res));
                } else {
                    putary[index] = 0;
                }
                resolve();
            });
        }));
    }
    Promise.all(promises).then(function() {
        //for (var i=0; i<6; i++) {
            //console.log("putary[" + i + "] = " + putary[i]);
        //}
        cb(putary);
    });
};

Contract.prototype.getAccuracy = function() {
    return this.getValue('callary')[3];
};

Contract.prototype.getCallPrice = function(str) {
    var strike = parseFloat(str);
    var spot = parseFloat(this.getValue('spot'));
    var call = this.getValue('callary');
    var delta = parseFloat(call[0]);
    var x1 = spot - 2 * delta;
    var x2 = spot - delta;
    var x3 = spot + delta;
    var x4 = spot + 2 * delta;
    if (strike < x1) {
        var res = call[1] + x1 - strike;
    } else if (strike >= x1 && strike < x2) {
        res = call[1] - (strike - x1) * (call[1] - call[2]) / call[0];
    } else if (strike >= x2 && strike < spot) {
        res = call[2] - (strike - x2) * (call[2] - call[3]) / call[0];
    } else if (strike >= spot && strike < x3) {
        res = call[3] - (strike - spot) * (call[3] - call[4]) / call[0];
    } else if (strike >= x3 && strike < x4) {
        res = call[4] - (strike - x3) * (call[4] - call[5]) / call[0];
    } else {
        res = call[5];
    }
    return res;
};

Contract.prototype.getPutPrice = function(str) {
    var strike = parseFloat(str);
    var spot = parseFloat(this.getValue('spot'));
    var put = this.getValue('putary');
    var delta = parseFloat(put[0]);
    var x1 = spot - 2 * delta;
    var x2 = spot - delta;
    var x3 = spot + delta;
    var x4 = spot + 2 * delta;
    if (strike < x1) {
        var res = put[1];
    } else if (strike >= x1 && strike < x2) {
        res = put[1] + (strike - x1) * (put[2] - put[1]) / put[0];
    } else if (strike >= x2 && strike < spot) {
        res = put[2] + (strike - x2) * (put[3] - put[2]) / put[0];
    } else if (strike >= spot && strike < x3) {
        res = put[3] + (strike - spot) * (put[4] - put[3]) / put[0];
    } else if (strike >= x3 && strike < x4) {
        res = put[4] + (strike - x3) * (put[5] - put[4]) / put[0];
    } else {
        res = put[5] + strike - x4;
    }
    return res;
};

Contract.prototype.getCallQty = function(strike) {
    var premium = globals.LONG_AMOUNT;
    var price = this.getCallPrice(strike);
    return premium / price;
};

Contract.prototype.getPutQty = function(strike) {
    var premium = globals.LONG_AMOUNT;
    var price = this.getPutPrice(strike);
    return premium / price;
};

Contract.prototype.funcmap = {
    "created": Contract.prototype.cbGetCreated,
    "modified": Contract.prototype.cbGetModified,
    "supplier": Contract.prototype.cbGetSupplier,
    "demander": Contract.prototype.cbGetDemander,
    "market": Contract.prototype.cbGetMarket,
    "backing": Contract.prototype.cbGetBacking,
    "spot": Contract.prototype.cbGetSpot,
    "type": Contract.prototype.cbGetType,
    "state": Contract.prototype.cbGetState,
    "duration": Contract.prototype.cbGetDuration,
    "premium": Contract.prototype.cbGetPremium,
    "quantity": Contract.prototype.cbGetQuantity,
    "strike": Contract.prototype.cbGetStrike,
    "expiration": Contract.prototype.cbGetExpiration,
    "callary": Contract.prototype.cbGetCallAry,
    "putary": Contract.prototype.cbGetPutAry
};

// END UPDATE FUNCTIONS

Contract.prototype.getValue = function(name) {
    if (this.local[name] === undefined) throw new Error('Undefined value: ' + name);
    return this.local[name];
};

Contract.prototype.isCall = function() {
    return this.getValue('type') == true;
};

Contract.prototype.isPut = function() {
    return this.getValue('type') == false;
};

Contract.prototype.isMine = function() {
    return this.getValue('supplier') == globals.web3.eth.defaultAccount;
};

Contract.prototype.isLong = function(addr) {
    return this.getValue('demander') == addr;
};

Contract.prototype.isShort = function(addr) {
    return this.getValue('supplier') == addr;
};

Contract.prototype.isQuote = function() {
    return this.getValue('state') == 0;
};

Contract.prototype.isTrade = function() {
    return this.getValue('state') == 1;
};

Contract.prototype.isDone = function() {
    return this.getValue('state') == 2;
};

Contract.prototype.updateContractSpot = function(price, success, fail) {
    this.contract.updateContractSpot(globals.web3.toWei(price), {gas: 250000}, function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Contract spot updated"
            });
        }
    });
};

Contract.prototype.updateContractVol = function(vol, success, fail) {
    var price = this.getValue('spot');
    var obj = approx(price, vol * 5, vol);
    var cw = [];
    var pw = [];
    for (var i=0; i<6; i++) {
        if (i > 0 && i < 5 && obj.call[i] < obj.call[i+1]) throw new Error("call prices must be non-increasing");
        if (i > 0 && i < 5 && obj.put[i] > obj.put[i+1]) throw new Error("put prices must be non-decreasing");
        cw[i] = globals.web3.toWei(obj.call[i]);
        pw[i] = globals.web3.toWei(obj.put[i]);
        //console.log("i=" + i + " " + obj.call[i] + " " + obj.put[i]);
    }
    this.contract.updateContractCallPutPrices(cw, pw, {gas: 250000}, function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Contract call, put prices updated"
            });
        }
    });
};

Contract.prototype.unrealizedCommission = function(cb) {
    if (cb == null) sync_msg();
    //if (this.isQuote()) {
        var market = this.getValue('market');
        var address = this.contract.address;
        //console.log("market=" + market);
        //console.log("address=" + address);
        this.api.getUnrealizedCommission(market, address, function(ucomm) {
            cb(ucomm);
        });
    //} else {
        //cb(0);
    //}
};

Contract.prototype.tradeMatch = function(callput, longshort, success, fail) {
    this.contract.tradeMatch(callput, globals.web3.toWei(globals.LONG_AMOUNT), longshort, {gas: 1250000}, function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Contract matched"
            });
        } else {
            if (fail != null) fail(err.message);
        }
    });
};

Contract.prototype.tradeEnd = function(success, fail) {
    this.contract.tradeEnd({gas: 2000000}, function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Trade ended"
            });
        } else {
            if (fail != null) fail(err.message);
        }
    });
};

Contract.prototype.cancel = function(success, fail) {
    this.contract.cancel({gas: 2000000}, function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Contract canceled"
            });
        } else {
            if (fail != null) fail(err.message);
        }
    });
};

// ContractList

var ContractList = function(addr) {
    this.list = globals.create('MTMLinkedList', addr);
    this.cur = 0x0;
};

ContractList.prototype.iterate = function(cb) {
    if (cb == null) sync_msg();
    var context = this;
    return new Promise(function(resolve, reject) {
        function test(err, res) {
            if (!err) {
                if (res == 0x0) {
                    resolve();
                } else {
                    cb(new Contract(res));
                    next(res);
                }
            }
        }
        function next(cur) {
            context.list.iterNext(cur, test);
        }
        context.list.iterFirst(test);
    });
};

ContractList.prototype.numContracts = function(cb) {
    if (cb == null) {
        return this.list.numContracts();
    } else {
        this.list.numContracts(function(err, res) {
            if (!err) {
                cb(res);
            }
        });
    }
};

// API

var API = function(cb) {
    this.transaction_callbacks = [];
    this.contractevent_callbacks = [];
    this.markettick_callbacks = [];
    this.seq = -1;
};

API.prototype.verifyIncludedTx = function(hash) {
    var gas = 0;
    var gasUsed = 0;
    var p1 = new Promise(function(resolve, reject) {
        globals.web3.eth.getTransaction(hash, function(err, res) {
            if (err) {
                reject();
            } else {
                //console.log("transaction=" + JSON.stringify(res));
                gas = res.gas;
                resolve();
            }
        });
    });
    var p2 = new Promise(function(resolve, reject) {
        globals.web3.eth.getTransactionReceipt(hash, function(err, res) {
            if (err) {
                reject();
            } else {
                //console.log("receipt=" + JSON.stringify(res));
                gasUsed = res.gasUsed;
                resolve();
            }
        });
    });
    Promise.all([p1,p2]).then(function() {
        for (var i=0; i<globals.pendingTransactions.length; i++) {
            if (globals.pendingTransactions[i].trans == hash) {
                if (gas == gasUsed) {
                    var fn = globals.pendingTransactions[i].err;
                    if (fn != null) fn();
                } else {
                    console.log(globals.pendingTransactions[i].msg);
                    fn = globals.pendingTransactions[i].cb;
                    if (fn != null) fn();
                }
                globals.pendingTransactions.splice(i,1);
                break;
            }
        }
    });
};

API.prototype.init = function() {
    var context = this;
    globals.web3.eth.filter("latest").watch(function(e, hash) {
        globals.web3.eth.getBlock(hash, function(err, block) {
            if (!err && block != null) {
                // New block
                while (context.lastblock < block.number) {
                    //console.log("new block: " + block.number);
                    context.blockNumber = ++context.lastblock;
                    if (globals.logging) {
                        console.log("Block: transaction queue length=" + globals.pendingTransactions.length);
                    }
                    for (var i=0; i<globals.pendingTransactions.length; i++) {
                        var pend = globals.pendingTransactions[i];
                        for (var j=0; j<block.transactions.length; j++) {
                            if (block.transactions[j] == pend.trans) {
                                if (globals.logging) {
                                    console.log("Transaction on block: " + pend.trans);
                                }
                                context.verifyIncludedTx(pend.trans);
                                break;
                            }
                        }
                    }
                    for (var i = 0; i<globals.onNewBlock.length; i++) {
                        globals.onNewBlock[i](context.blockNumber);
                    }
                }
            }
        });
    });
    function fetchABI(name) {
        return new Promise(function(resolve, reject) {
            globals.mtm.getABI(name, function(err, res) {
                if (err) {
                    console.log(err.message);
                    reject();
                } else {
                    //console.log(name + "=" + res);
                    globals.abis[name] = res;
                    resolve();
                }
            });
        });
    }
    return Promise.all([
        fetchABI('MTMLogManager'), 
        fetchABI('MTMClientAPI'),
        fetchABI('MTMLinkedList'),
        fetchABI('MTMContract'),
        fetchABI('MTMAPI'),
        fetchABI('MTMWebAuth')
    ]).then(function() {
        var p1 = new Promise(function(resolve, reject) {
            globals.mtm.getContract('clientapi', function(err, res) {
                if (err) {
                    console.log(err.message);
                    reject();
                } else {
                    context.api = globals.create('MTMClientAPI', res);
                    resolve();
                }
            });
        });
        var p2 = new Promise(function(resolve, reject) {
            globals.mtm.getContract('logmgr', function(err, res) {
                if (err) {
                    console.log(err.message);
                    reject();
                } else {
                    context.logmgr = globals.create('MTMLogManager', res);
                    resolve();
                }
            });
        });
        var p3 = new Promise(function(resolve, reject) {
            globals.mtm.getContract('webauth', function(err, res) {
                if (err) {
                    console.log(err.message);
                    reject();
                } else {
                    context.webauth = globals.create('MTMWebAuth', res);
                    resolve();
                }
            });
        });
        var p4 = new Promise(function(resolve, reject) {
            globals.web3.eth.getBlockNumber(function(err, res) {
                if (err) {
                    console.log(err.message);
                    context.lastblock = 0;
                    context.blockNumber = 0;
                    reject();
                } else {
                    context.lastblock = res;
                    context.blockNumber = res;
                    resolve();
                }
            });
        });
        return Promise.all([p1, p2, p3, p4]);
    });
};

// TEST ONLY
API.prototype.create = globals.create;
// TEST ONLY

API.prototype.logging = function(b) {
    globals.logging = (b === true);
};

API.prototype.getABI = function(name, cb) {
    if (cb == null) sync_msg();
    globals.mtm.getABI(name, function(err, res) {
        if (!err) {
            cb(res);
        }
    });
};

API.prototype.getAddress = function(name, cb) {
    if (cb == null) sync_msg();
    globals.mtm.getContract(name, function(err, res) {
        if (!err) {
            cb(res);
        }
    });
};

API.prototype.hasAccount = function(cb) {
    if (cb == null) {
        return this.api.hasAccount();
    } else {
        this.api.hasAccount(function(err, res) {
            if (!err) {
                cb(res);
            }
        });
    }
};

API.prototype.createAccount = function(success, fail) {
    console.log("Creating account");
    this.api.createAccount({gas: 500000}, function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Account created"
            });
        } else {
            console.log(err.message);
            if (fail != null) fail(err.message);
        }
    }); 
};

API.prototype.getBalance = function(cb) {
    if (cb == null) {
        return globals.web3.fromWei(this.api.getBalance());
    } else {
        this.api.getBalance(function(err, res) {
            if (!err) {
                cb(globals.web3.fromWei(res));
            }
        });
    }
};

API.prototype.getEscrow = function(cb) {
    if (cb == null) sync_msg();
    //if (this.api.hasAccount()) {
    this.api.getEscrow(function(err, res) {
        if (!err) {
            cb(globals.web3.fromWei(res));
        }
    });
};

API.prototype.deposit = function(amount, success, fail) {
    this.api.deposit({value: globals.web3.toWei(amount), gas: 250000}, function(err, res) {
        if (!err) {
            if (globals.logging) {
                console.log("Deposit transaction: " + res);
            }
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Deposit sent"
            });
        } else {
            if (fail != null) fail(err.message);
        }
    });
};

API.prototype.withdraw = function(amount, success, fail) {
    this.api.withdraw(globals.web3.toWei(amount), {gas: 250000}, function(err, res) {
        if (!err) {
            if (globals.logging) {
                console.log("Withdraw transaction: " + res);
            }
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Withdrawal sent"
            });
        }    
    });
};

API.prototype.hasMarket = function(name, cb) {
    if (cb == null) {
        return this.api.hasMarket(name);
    } else {
        this.api.hasMarket(name, function(err, res) {
            if (!err) {
                cb(res);
            }
        });
    }
};

API.prototype.createMarket = function(name, cb) {
    if (cb == null) {
        var t = this.api.createMarket(name, {gas: 500000});
        globals.pendingTransactions.push({
            trans: t,
            msg: "Market created"
        });
        return t;
    } else {
        this.api.createMarket(name, {gas: 500000}, function(err, res) {
            if (!err) {
                globals.pendingTransactions.push({
                    trans: res,
                    cb: cb,
                    msg: "Market created"
                });
            } 
        });
    }
};

API.prototype.getHistory = function(name, from, to, cb) {
    if (cb == null) sync_msg();
    var tickEvent = this.logmgr.MarketTick({mid:name},{fromBlock:from,toBlock:to});
    var arr = [];
    tickEvent.get(function(error, logs) {
        logs.map(function(log) {
            arr.push({
                id: log.transactionHash,
                block: log.blockNumber,
                data: parseFloat(globals.web3.fromWei(log.args.tick))
            });
        });
        cb(arr);
    });
};

API.prototype.getTransactionHistory = function(acct, from, to, cb) {
    if (cb == null) sync_msg();
    var transEvent = this.logmgr.TransactionEvent({acct:acct},{fromBlock:from,toBlock:to});
    var arr = [];
    if (from < 0) from = 0;
    transEvent.get(function(error, logs) {
        logs.map(function(log) {
            arr.push({
                id: log.transactionHash,
                block: log.blockNumber,
                type: globals.TransactionEvent[log.args.id],
                acct: log.args.acct,
                amount: globals.web3.fromWei(log.args.amount),
                //amount: log.args.amount,
                balance: globals.web3.fromWei(log.args.balance),
                ctr: log.args.ctr
            });
        });
        cb(arr);
    });
};

API.prototype.getTradeHistory = function(acct, from, to, cb) {
    if (cb == null) sync_msg();
    var ctrEvent = this.logmgr.ContractEvent({acct:acct},{fromBlock:from,toBlock:to});
    var arr = [];
    ctrEvent.get(function(error, logs) {
        logs.map(function(log) {
            arr.push({
                block: log.blockNumber,
                id: log.args.ctr,
                type: globals.ContractEvent[log.args.id],
                mid: globals.web3.toAscii(log.args.mid).replace(/\u0000/g, ''),
                ref: globals.web3.fromWei(log.args.ref)
            });
        });
        cb(arr);
    });
};

API.prototype.getCommissionHistory = function(market, from, to, cb) {
    if (cb == null) sync_msg();
    var commEvent = this.logmgr.CommissionEvent({mid:market},{fromBlock:from,toBlock:to});
    var arr = [];
    commEvent.get(function(error, logs) {
        logs.map(function(log) {
            arr.push({
                block: log.blockNumber,
                type: globals.CommissionEvent[log.args.id],
                amount: globals.web3.fromWei(log.args.amount),
                numContracts: log.args.num,
                perContract: globals.web3.fromWei(log.args.per),
                balance: globals.web3.fromWei(log.args.balance),
                contract: log.args.ctr
                //amount: globals.web3.fromWei(log.args.amount),
                //balance: globals.web3.fromWei(log.args.balance)
            });
        });
        cb(arr);
    });
};

API.prototype.getContractHistory = function(ctr, cb) {
    if (cb == null) sync_msg();
    var history = {
        state: 'undefined',
        address: ctr,
        transactions: [],
        events: []
    };
    var contract = globals.create('MTMContract', ctr);   
    var api = this;
    var p1 = new Promise(function(resolve, reject) {
        var transEvent = api.logmgr.TransactionEvent({ctr:ctr},{fromBlock:0,toBlock:'latest'});
        transEvent.get(function(error, logs) {
            logs.map(function(log) {
                history.transactions.push({
                    id: log.transactionHash,
                    block: log.blockNumber,
                    type: globals.TransactionEvent[log.args.id],
                    acct: log.args.acct,
                    amount: globals.web3.fromWei(log.args.amount),
                    ctr: log.args.ctr
                });
            });
            resolve();
        });
    });
    var p2 = new Promise(function(resolve, reject) {
        var ctrEvent = api.logmgr.ContractEvent({ctr:ctr},{fromBlock:0,toBlock:'latest'});
        ctrEvent.get(function(error, logs) {
            logs.map(function(log) {
                if (log.args.id == 1) { // NEW
                    history.start = log.blockNumber;
                    history.state = "quote";
                }
                if (log.args.id == 3) { // MATCH
                    history.trade = log.blockNumber;
                    history.state = "trade";
                }
                if (log.args.id == 4) { // CNCL
                    history.end = log.blockNumber;
                    history.state = "canceled";
                }
                if (log.args.id == 5) { // END
                    history.end = log.blockNumber;
                    history.state = "complete";
                }
                if (log.args.id != 2) { // UPD
                    history.events.push({
                        id: log.transactionHash,
                        block: log.blockNumber,
                        type: globals.ContractEvent[log.args.id],
                        acct: log.args.acct,
                        ctr: log.args.ctr
                    });
                }
            });
            resolve();
        });
    });
    var p3 = new Promise(function(resolve, reject) {
        var createEvent = contract.Create({ctr:ctr},{fromBlock:0,toBlock:'latest'});
        createEvent.get(function(err, logs) {
            if (!err) {
                logs.map(function(log) {
                    history.market = globals.web3.toAscii(log.args.market).replace(/\u0000/g, '');
                    history.duration = log.args.duration;
                    history.backing = globals.web3.fromWei(log.args.backing);
                });
            }
            resolve();
        });
    });
    var p4 = new Promise(function(resolve, reject) {
        var matchEvent = contract.Match({ctr:ctr},{fromBlock:0,toBlock:'latest'});
        matchEvent.get(function(err, logs) {
            if (!err) {
                logs.map(function(log) {
                    history.matchBlock = log.blockNumber;
                    history.short = log.args.supplier;
                    history.long = log.args.demander;
                    if (log.args.cp) history.type = "call";
                    else history.type = "put";
                    history.premium = globals.web3.fromWei(log.args.premium);
                    history.qty = globals.web3.fromWei(log.args.qty);
                    history.strike = globals.web3.fromWei(log.args.strike);
                });
            }
            resolve();
        });
    });
    var p5 = new Promise(function(resolve, reject) {
        var settleEvent = contract.Settle({ctr:ctr},{fromBlock:0,toBlock:'latest'});
        settleEvent.get(function(err, logs) {
            if (!err) {
                logs.map(function(log) {
                    history.settleBlock = log.blockNumber;
                    history.settle = globals.web3.fromWei(log.args.settle);
                    history.long_settle = globals.web3.fromWei(log.args.dsettle);
                    history.short_settle = globals.web3.fromWei(log.args.ssettle);
                });
            }
            resolve();
        });
    });
    Promise.all([p1, p2, p3, p4, p5]).then(function() {
        cb(history);
    });
};

API.prototype.getContractTimeline = function(ctr, cb) {
    if (cb == null) sync_msg();
    var timeline = {
        start: 0,
        trade: 'latest',
        end: 'latest'
    };
    var ctrEvent = this.logmgr.ContractEvent({ctr:ctr},{fromBlock:0,toBlock:'latest'});
    ctrEvent.get(function(error, logs) {
        logs.map(function(log) {
            if (log.args.id == 1) { // NEW
                timeline.start = log.blockNumber;
                timeline.state = "quote";
            }
            if (log.args.id == 3) { // MATCH
                timeline.trade = log.blockNumber;
                timeline.state = "trade";
            }
            if (log.args.id == 4) { // CNCL
                timeline.end = log.blockNumber;
                timeline.state = "canceled";
            }
            if (log.args.id == 5) { // END
                timeline.end = log.blockNumber;
                timeline.state = "complete";
            }
        });
        cb(timeline);
    });
};

API.prototype.createContract = function(name, price, dur, vol, success, fail) {
    //if (!this.hasMarket(name)) throw new Error("no such market: " + name);
    var obj = approx(price, vol * 5, vol);
    var cw = [];
    var pw = [];
    //console.log("strike=" + price + " vol=" + vol);
    for (var i=0; i<6; i++) {
        if (i > 0 && i < 5 && obj.call[i] < obj.call[i+1]) throw new Error("call prices must be non-increasing");
        if (i > 0 && i < 5 && obj.put[i] > obj.put[i+1]) throw new Error("put prices must be non-decreasing");
        cw[i] = globals.web3.toWei(obj.call[i]);
        pw[i] = globals.web3.toWei(obj.put[i]);
        //console.log("i=" + i + " " + obj.call[i] + " " + obj.put[i]);
    }
    this.api.createContract(name, globals.web3.toWei(globals.SHORT_AMOUNT), globals.web3.toWei(price), 
        dur, cw, pw, {gas: 3000000}, function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Contract created"
            });
        } else {
            if (fail != null) fail(err.message);
        }
    });
};

API.prototype.validContract = function(addr, cb) {
    if (cb == null) sync_msg();
    this.api.validContract(addr, function(err, res) {
        if (!err) {
            cb(res);
        }
    });
};

API.prototype.fetchContract = function(addr, values, cb) {
    if (cb == null) sync_msg();
    var context = this;
    this.api.validContract(addr, function(err, res) {
        if (!res) {
            console.log("Attempted to fetch expired contract");
            console.trace();
        }
        if (!err && res) {
            var contract = new Contract(addr, context);
            contract.getValues(values, function() {
                cb(contract);
            });
        }
    });
};

API.prototype.fetchOldContract = function(addr, values, cb) {
    if (cb == null) sync_msg();
    // we may want to construct a contract on a historical address
    // to fetch the events even though the contract has been deleted
    var contract = new Contract(addr, this);
    contract.getValues(values, function() {
        cb(contract);
    });
};

API.prototype.numAccountContracts = function(cb) {
    if (cb == null) sync_msg();
    //if (!this.hasAccount()) throw new Error("no account");
    this.api.getAccountContracts(function(err, res) {
        if (!err && res != 0x0) {
            var list = new ContractList(res);
            list.numContracts(function(res) {
                cb(res);
            });
        }
    });
};

API.prototype.getAccountContractList = function(cb) {
    if (cb == null) {
        return new ContractList(this.api.getAccountContracts());
    } else {
        this.api.getAccountContracts(function(err, res) {
            if (!err && res != 0x0) {
                cb(new ContractList(res));
            }
        });
    }
};

API.prototype.getMarketContractList = function(name, cb) {
    if (cb == null) {
        return new ContractList(this.api.getMarketContracts(name));
    } else {
        //if (!this.hasMarket(name)) throw new Error("no such market: " + name);
        this.api.getMarketContracts(name, function(err, res) {
            if (!err) {
                cb(new ContractList(res));
            }
        });
    }
};

API.prototype.getMarketSpot = function(name, cb) {
    if (cb == null) sync_msg();
    this.api.getMarketSpot(name, function(err, res) {
        if (!err) {
            cb(globals.web3.fromWei(res));
        }
    });
};

API.prototype.getUnrealizedCommission = function(name, ctr, cb) {
    if (cb == null) sync_msg();
    this.api.getUnrealizedCommission(name, ctr, function(err, res) {
        if (!err) {
            cb(globals.web3.fromWei(res));
        }
    });
};

API.prototype.getTradeContractList = function(cb) {
    if (cb == null) sync_msg();
    this.api.getTradeContracts(function(err, res) {
        if (!err) {
            cb(new ContractList(res));
        }
    });
};

API.prototype.onTransaction = function(cb) {
    if (this.transaction_callbacks.length == 0) {
        var apiobj = this;
        this.logmgr.TransactionEvent().watch(function(err, res) {
            //console.log("internal transaction callback: " + res.args.seq);
            if (!err
                && res.args.acct == globals.web3.eth.defaultAccount) {
                for (var i=0; i<apiobj.transaction_callbacks.length; i++) {
                    var context = apiobj.transaction_callbacks[i];
                    var bal = apiobj.getBalance(function(bal) {
                        context(globals.TransactionEvent[res.args.id], res.args.amount, bal);
                    });
                }
                apiobj.seq = res.args.seq;
            }
        });
    }
    this.transaction_callbacks.push(cb);
};

API.prototype.onContractEvent = function(cb) {
    if (this.contractevent_callbacks.length == 0) {
        var apiobj = this;
        this.logmgr.ContractEvent().watch(function(err, res) {
            if (!err) {
                for (var i=0; i<apiobj.contractevent_callbacks.length; i++) {
                    apiobj.contractevent_callbacks[i](globals.ContractEvent[res.args.id], 
                        globals.web3.toAscii(res.args.mid).replace(/\u0000/g, ''),
                        res.args.ctr, res.args.acct, globals.web3.fromWei(res.args.ref));
                }
                apiobj.seq = res.args.seq;
            }
        });
    }
    this.contractevent_callbacks.push(cb);
};

API.prototype.onMarketTick = function(market, cb) {
    if (this.markettick_callbacks.length == 0) {
        var apiobj = this;
        this.logmgr.MarketTick({mid:market}).watch(function(err, res) {
            var m = globals.web3.toAscii(res.args.mid).replace(/\u0000/g, '');
            if (!err /*&& m == market*/ ) {
                for (var i=0; i<apiobj.markettick_callbacks.length; i++) {
                    apiobj.markettick_callbacks[i](m, globals.web3.fromWei(res.args.tick));
                }
                apiobj.seq = res.args.seq;
            }
        });
    }
    this.markettick_callbacks.push(cb);
};

API.prototype.onNewBlock = function(cb) {
    globals.onNewBlock.push(cb);
};

API.prototype.blackscholes = blackscholes;

API.prototype.setWebAuth = function(str, success, fail) {
    return this.webauth.set(globals.web3.sha3(str), function(err, res) {
        if (!err) {
            globals.pendingTransactions.push({
                trans: res,
                cb: success,
                err: fail,
                msg: "Username registered"
            });
        }
    });
};

API.prototype.getWebAuth = function(addr, cb) {
    if (cb == null) {
        return this.webauth.get(addr);
    } else {
        this.webauth.get(addr, function(err, res) {
            if (!err) {
                cb(res);
            }
        });
    }
};

module.exports.init = function(web3, addr, cb) {
    if (cb == null) sync_msg();
    globals.web3 = web3;
    globals.mtm = globals.web3.eth.contract(JSON.parse(globals.abis['MTM'])).at(addr);
    var api = new API();
    api.init().then(function() {
        cb(api);
    });
};
