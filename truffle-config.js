const HDWalletProvider = require("@truffle/hdwallet-provider")
const {privateKey, publicKey} = require("./privatekey")

module.exports = {
  networks: {
    development: {
     host: "127.0.0.1",
     port: 8545,
     network_id: "*",
    },
    // live: {
    //   provider: function() {
    //     return new HDWalletProvider(privateKey, "https://mainnet.infura.io/v3/a07aaaeb8e1c4277a1d9354b5b420548")
    //   },
    //   network_id: 1,
    //   gasPrice: 71e9,
    //   from: publicKey,
    //   gas: 8e6
    // },
    ropsten: {
      provider: function () {
        var wallet = new HDWalletProvider(privateKey, 'https://ropsten.infura.io/v3/b0b8be8fbe3646bdae0d45d5ac7d8265');
        // var nonceTracker= new NonceTrackerSubprovider();
        // wallet.engine._providers.unshift(nonceTracker);
        // nonceTracker.setEngine(wallet.engine);
        return wallet;
      },
      gas: 4000000,
      network_id: 3, // Match any network id
    },
    bsctest: {
      provider: () => new HDWalletProvider(privateKey, `https://data-seed-prebsc-1-s1.binance.org:8545`),
      network_id: 97,
      confirmations: 1,
      timeoutBlocks: 200,
      skipDryRun: true
    },
    // bsc: {
    //   provider: () => new HDWalletProvider(privateKey, `https://bsc-dataseed1.binance.org`),
    //   network_id: 56,
    //   confirmations: 1,
    //   timeoutBlocks: 200,
    //   skipDryRun: true
    // },
  },

  compilers: {
    solc: {
      version: "0.5.16",
      docker: false,
      settings: {
       optimizer: {
         enabled: true,
         runs: 200
       },
       evmVersion: "byzantium"
      }
    }
  }
}
