# microtick-api
## Microtick API and Examples

The following information is a work in progress.  There are many more functions available than are currently documented.  Most should be fairly intuitive.  Please direct questions to support@microtick.com.

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

#### getAccountContractList

#### getMarketContractList

#### getMarketSpot


