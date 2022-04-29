require('dotenv').config();
// eslint-disable-next-line no-unused-vars
const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  compilers: {
    solc: {
      version: '0.8.12', // A version or constraint - Ex. "^0.5.0"
      // Can also be set to "native" to use a native solc
      parser: 'solcjs', // Leverages solc-js purely for speedy parsing
      settings: {
        optimizer: {
          enabled: true,
        },
      },
    },
  },
  plugins: [
    'truffle-plugin-verify',
  ],
  api_keys: {
    polygonscan: process.env.POLYGONSCAN_API_KEY,
  },
  networks: {
    // to test a deploy:
    // 1. uncomment the ganache network part.
    // 2. "ganache-cli -d"
    // 3. "truffle migrate  --network ganache"
    // ganache: { // 0x83A909262608c650BD9b0ae06E29D90D0F67aC5e
    //   provider: new HDWalletProvider(
    //     "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
    //     "http://127.0.0.1:8545/"
    //   ),
    //   networkCheckTimeout: 1000000,
    //   timeoutBlocks: 5000, // # of blocks before a deployment times out  (minimum/default: 50)
    //   gasPrice: 20000000000,
    //   network_id: "*",
    // },

    // matic: {
    //   provider: new HDWalletProvider(
    //     process.env.DEPLOYER_MNEMONIC,
    //     "https://rpc-mainnet.maticvigil.com"
    //   ),
    //   network_id: 137,
    //   confirmations: 1,
    //   skipDryRun: true,
    // },

    // Try these Mumbai nodes:
    // - 'https://rpc-mumbai.maticvigil.com'
    // - 'https://matic-mumbai.chainstacklabs.com'
    // matictestnet: {
    //   provider: new HDWalletProvider(
    //     process.env.DEPLOYER_MNEMONIC,
    //     'https://matic-mumbai.chainstacklabs.com',
    //   ),
    //   network_id: 80001,
    //   confirmations: 1,
    //   skipDryRun: true,
    //   erc20data: {
    //     deploy: true,
    //     erc20TokenName: 'FVERC20TEST',
    //     erc20TokenSymbol: 'FVT',
    //   },
    //   paymentsData: {
    //     erc20address: '',
    //     currencyDescriptor: 'FVERC20TEST test coins on Mumbai',
    //   },
    // },
    // xdai: { // 0xA9c0F76cA045163E28afDdFe035ec76a44f5C1F3
    //   provider: new HDWalletProvider(
    //     process.env.DEPLOYER_MNEMONIC,
    //     'https://rpc.xdaichain.com/', // others: http://xdai.blackhole.gorengine.com:51943/ wss://xdai.poanetwork.dev/wss http://xdai.poanetwork.dev/ wss://rpc.xdaichain.com/wss
    //   ),
    //   network_id: 100,
    //   gasPrice: 5000000000, // fast = 5000000000, slow = 1000000000
    //   erc20data: {
    //     deploy: true,
    //     erc20TokenName: 'FVXDAI',
    //     erc20TokenSymbol: 'FVXDAI',
    //   },
    //   paymentsData: {
    //     erc20address: '',
    //     currencyDescriptor: 'FVERC20TEST test coins on the XDAI network',
    //   },
    //   networkCheckTimeout: 1000000,
    //   timeoutBlocks: 5000, // # of blocks before a deployment times out  (minimum/default: 50)
    // },
    // Set default mocha options here, use special reporters etc.
    // mocha: {
    //   reporter: 'eth-gas-reporter',
    //   timeout: 100000
    // }
  },
};
