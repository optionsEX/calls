module.exports = {
  // default applies to all environments
  default: {
    library: 'embarkjs',
    // order of connections the dapp should connect to
    dappConnection: [
      "$EMBARK",
      "$WEB3",  // uses pre existing web3 object if available (e.g in Mist)
      "ws://localhost:8546",
      "http://localhost:8545"
    ],

    gas: "auto",

    deploy: {
      // example:
      //SimpleStorage: {
      //  args: [ 100 ]
      //}
    }
  },

  // default environment, merges with the settings in default
  // assumed to be the intended environment by `embark run`
  development: {
    library: 'embarkjs',
    dappConnection: [
      "$EMBARK",
      "ws://localhost:8546",
      "http://localhost:8545",
      "$WEB3"  // uses pre existing web3 object if available (e.g in Mist)
    ],
    gas: "auto"
  },

  // merges with the settings in default
  // used with "embark run privatenet"
  privatenet: {
  },

  // merges with the settings in default
  // used with "embark run testnet"
  testnet: {
  },

  // merges with the settings in default
  // used with "embark run livenet"
  livenet: {
  },

  // you can name an environment with specific settings and then specify with
  // "embark run custom_name" or "embark blockchain custom_name"
  //custom_name: {
  //}
};
