/* eslint-disable no-undef */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-console */
require('chai')
  .use(require('chai-as-promised'))
  .should();

const MyToken = artifacts.require('MyToken');
const PaymentsERC20 = artifacts.require('PaymentsERC20');

module.exports = (deployer, network) => {
  if (network === 'test') return;
  deployer.then(async () => {
    console.log(`Deploying to network: ${network}`);

    const { erc20data } = deployer.networks[network];
    const { paymentsData } = deployer.networks[network];
    let erc20address;

    // Only deploys the test ERC20 token if required,
    // otherwise, use the address provided in paymentsData.
    if (erc20data?.deploy) {
      console.log('* Deploying ERC20... ');
      console.log('  ...with name: ', erc20data.erc20TokenName);
      console.log('  ...with symbol: ', erc20data.erc20TokenSymbol);
      const erc20 = await MyToken.new(
        erc20data.erc20TokenName,
        erc20data.erc20TokenSymbol,
      ).should.be.fulfilled;
      erc20address = erc20.address;
      console.log('🚀  ERC20 deployed at: ', erc20address);
    } else {
      console.log(paymentsData);
      erc20address = paymentsData.erc20address;
      console.log('🚀  Re-using previously deployed ERC20 deployed at: ', erc20address);
    }

    console.log('* Deploying Cryptopayments... ');
    console.log('  ...with associated ERC20 at: ', erc20address);
    console.log('  ...with description: ', paymentsData.currencyDescriptor);
    const payments = await PaymentsERC20.new(
      erc20address,
      paymentsData.currencyDescriptor,
    ).should.be.fulfilled;

    console.log('🚀  Cryptopayments deployed at:', payments.address);
  });
};
