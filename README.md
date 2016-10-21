# microtick-api
## Microtick API and Examples

The following information is a work in progress.  There are many more functions available than are currently documented.  Most should be fairly intuitive.  Please direct questions to support@microtick.com, or file an issue here on Github. There is also a Slack channel and a Forum, depending on the issue.

The Microtick API allows automated trading clients to be created for use on http://www.microtick.com.  To use the api, initialize with:

```
var mtmapi = require('./mtmapi.js');
var Web3 = require('web3');
var web3 = new Web3();

// Main MTM contract address
var mtmaddr = '';

mtmapi.init(web3, mtmaddr, function(api) {
    // Use the api object to access Microtick functions
});
```

### API Functions

#### hasAccount()

Returns true if a Microtick account has been created for this Ethereum account (identity).  New accounts are seeded with 1000 tokens for trading.

#### createAccount(success, fail)

Called to create an account. You may provide optional success and fail callbacks.

```
api.createAccount(function() {
  // Success
}, function() {
  // Fail
});
```

#### getBalance()

Returns the current balance of tokens for this Microtick account.

#### getEscrow()

Returns the current balance of escrowed tokens for this account. Escrowed tokens are used to back data quotes submitted to the marketplace.

#### createContract(feed, spot, dur, vol, success, fail)

Creates a new data quote on a feed.

* feed - name of the feed, i.e. ETHUSD
* spot - data value to submit
* dur - duration of quote (between 10 and 1000 on testnet)
* vol - expected volatility of data over the quoted duration. Typically the standard deviation of log returns for Black-Scholes pricing.
* success - callback for successful quote creation
* fail - callback for failure

#### getAccountContractList()

Returns a ContractList object that can be used to access the contracts that are currently open for the account currently logged in.

#### getMarketContractList(market)

Returns a ContractList object for the specified market, i.e. all contracts for ETHUSD.

#### getMarketSpot(market)

Returns the current average spot price for the given market. This is the access function available for anyone with Ethereum access to query the current spot price for any market, anytime.

### ContractList

#### iterate(cb)

Iterates over the contracts included in this contract list and calls the callback function provided for each with a Contract object.

#### numContracts()

Returns the number of contracts included in this ContractList.

### Contract

#### getValues(names, cb)

getValues() is used to query contract dynamic contract parameters.  Because there are quite a few of them, these are not returned in the Contract object by default because it would require too much overhead.  Names of parameters are passed in in an array and the callback is called when all params have been queried.

Parameters that can be queried include:

| Value       | Description                                                                              |
| ----------- | ---------------------------------------------------------------------------------------- |
| created     | Block number when the contract was created                                               |
| modified    | Block number when the contract was last modified or updated                              |
| supplier    | Liquidity supplier. Account that created the contract, or the short party in trade state |
| demander    | Liquidity demander. Account that matched (traded) the contract for long trades           |
| market      | Market string, i.e. ETHUSD                                                               |
| backing     | Ether amount backing the quote (for testnet this is hardcoded to 10)                     |
| spot        | Spot price supplier provided or updated. This is the "data value".                       |
| type        | true if Call, false if Put. Only valid in 'trade' state.                                 |
| state       | 0 = Quote, 1 = Trade, 2 = Complete                                                       |
| duration    | Block duration of quote                                                                  |
| premium     | Amount paid in premium to initiate the trade (for testnet this is hardcoded to 2)        |
| quantity    | Synthetic quantity. This is the premium paid, divided by the calculated option price.    |
| strike      | In trade state, this is the strike for the option.                                       |
| expiration  | In trade state, this is the expiration block for the option.                             |
| callary     | Internal use. Exposed for use of option pricing models other than Black-scholes          |
| putary      | Internal use. Exposed for use of option pricing models other than Black-scholes          |

#### getCallPrice(strike)

Returns the price for this quote, as a Call, for the provided strike. Uses the callary to interpolate the best approximation, given the array provided.

#### getPutPrice(strike)

Returns the price for this quote, as a Put, for the provided strike. Uses the putary to interpolate the best approximation, given the array provided.

#### getCallQty(strike)

Returns the synthetic quantity for this quote as a call, given the price for the current strike, and a hardcoded premium of 2. This hardcoded value will become dynamic in the future, but it's easier for now.

#### getPutQty(strike)

Returns the synthetic quantity for this quote as a put.

