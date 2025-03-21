/* eslint-disable no-undef */

const { assert } = require('chai');
const truffleAssert = require('truffle-assertions');
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignPayment, prepareDataToSignAssetTransfer } = require('../helpers/signer');
const { TimeTravel } = require('../helpers/TimeTravel');

require('chai')
  .use(require('chai-as-promised'))
  .should();

const MyToken = artifacts.require('MyToken');
const PaymentsERC20 = artifacts.require('PaymentsERC20');

const toBN = (x) => web3.utils.toBN(x);
const provideFunds = async (_from, _to, _initialBuyerETH) => {
  await web3.eth.sendTransaction({
    from: _from,
    to: _to,
    value: _initialBuyerETH,
  });
};

// Starting with an account created from a privateKey in these test scripts,
// it registers it in the environment testnet,
// so that it can be used to sign fund transfers.
// A bit hacky, but it works: just import and unlock.
const registerAccountInLocalTestnet = async (acc) => {
  const localAcc = await web3.eth.personal.importRawKey(acc.privateKey, 'dummyPassw');
  await web3.eth.personal.unlockAccount(localAcc, 'dummyPassw');
};

const fromHexString = (hexString) => new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

contract('CryptoPayments1', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'IBZ ERC20 IN POLYGON';
  const [deployer, alice] = accounts;
  const feesCollector = deployer;
  const buyerPrivKey = '0x3B878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const operatorPrivKey = '0x4A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const buyerAccount = web3.eth.accounts.privateKeyToAccount(buyerPrivKey);
  const operatorAccount = web3.eth.accounts.privateKeyToAccount(operatorPrivKey);
  const operator = operatorAccount.address;
  const name = 'MYERC20';
  const symbol = 'FV20';
  const defaultAmount = 300;
  const defaultFeeBPS = 500; // 5%
  const now = Math.floor(Date.now() / 1000);
  const timeToPay = 30 * 24 * 3600; // one month
  const deadline = now + timeToPay;
  const paymentData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    amount: defaultAmount.toString(),
    feeBPS: defaultFeeBPS,
    universeId: '1',
    deadline,
    buyer: buyerAccount.address,
    seller: alice,
  };
  // eslint-disable-next-line no-unused-vars
  const [NOT_STARTED, ASSET_TRANSFERRING, REFUNDED, PAID] = [0, 1, 2, 3];
  const initialBuyerERC20 = 100 * Number(paymentData.amount);
  const initialOperatorERC20 = 1250 * Number(paymentData.amount);
  const initialBuyerETH = 1000000000000000000;
  const initialOperatorETH = 6000000000000000000;
  const timeTravel = new TimeTravel(web3);

  let erc20;
  let payments;
  let snapshot;

  beforeEach(async () => {
    snapshot = await timeTravel.takeSnapshot();
    erc20 = await MyToken.new(name, symbol).should.be.fulfilled;
    payments = await PaymentsERC20.new(erc20.address, CURRENCY_DESCRIPTOR).should.be.fulfilled;
    await registerAccountInLocalTestnet(buyerAccount).should.be.fulfilled;
    await registerAccountInLocalTestnet(operatorAccount).should.be.fulfilled;
    await erc20.transfer(operator, initialOperatorERC20, { from: deployer });
    await provideFunds(deployer, operator, initialOperatorETH);
    await payments.setUniverseOperator(
      paymentData.universeId,
      operator,
    ).should.be.fulfilled;
  });

  afterEach(async () => {
    await timeTravel.revertToSnapShot(snapshot.result);
  });

  async function finalize(_paymentId, _success, _operatorPvk) {
    const data = { paymentId: _paymentId, wasSuccessful: _success };
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(_operatorPvk.slice(2)),
      prepareDataToSignAssetTransfer({
        msg: data,
        chainId: await web3.eth.getChainId(),
        contractAddress: payments.address,
      }),
    );
    await payments.finalize(
      data,
      signature,
    ).should.be.fulfilled;
  }

  // Executes a relayedPayment. Reused by many tests.
  // It first funds the buyer, then buyer approves, signs, and the operator relays the payment.
  async function executeRelayedPay(_paymentData, _initialBuyerERC20, _initialBuyerETH, _operator) {
    // Prepare Carol to be a buyer: fund her with ERC20, with ETH, and register her as seller
    await erc20.transfer(_paymentData.buyer, _initialBuyerERC20, { from: _operator });
    await provideFunds(_operator, buyerAccount.address, _initialBuyerETH);
    await payments.registerAsSeller({ from: _paymentData.seller }).should.be.fulfilled;

    // Buyer approves purchase allowance
    await erc20.approve(
      payments.address, _paymentData.amount, { from: _paymentData.buyer },
    ).should.be.fulfilled;

    // Buyer signs purchase
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(buyerPrivKey.slice(2)),
      prepareDataToSignPayment({
        msg: _paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: payments.address,
      }),
    );
    // Pay
    await payments.relayedPay(_paymentData, signature, { from: _operator }).should.be.fulfilled;
    return signature;
  }

  // Executes a Payment directly by buyer. Reused by many tests.
  // It first funds the buyer, then buyer approves, operators signs,
  // and the buyer relays the payment.
  async function executeDirectPay(_paymentData, _initialBuyerERC20, _initialBuyerETH) {
    // Prepare Carol to be a buyer: fund her with ERC20, with ETH, and register her as seller
    await erc20.transfer(_paymentData.buyer, _initialBuyerERC20, { from: deployer });
    await provideFunds(deployer, buyerAccount.address, _initialBuyerETH);
    await payments.registerAsSeller({ from: _paymentData.seller }).should.be.fulfilled;

    // Buyer approves purchase allowance
    await erc20.approve(
      payments.address, _paymentData.amount, { from: _paymentData.buyer },
    ).should.be.fulfilled;

    // Operator signs purchase
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignPayment({
        msg: _paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: payments.address,
      }),
    );

    // Pay
    await payments.pay(_paymentData, signature, { from: _paymentData.buyer }).should.be.fulfilled;
    return signature;
  }

  // eslint-disable-next-line no-unused-vars
  async function assertBalances(_contract, addresses, amounts) {
    for (let i = 0; i < addresses.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal(String(await _contract.balanceOf(addresses[i])), String(amounts[i]));
    }
  }

  it('payments start in NOT_STARTED state', async () => {
    assert.equal(await payments.paymentState(paymentData.paymentId), NOT_STARTED);
  });

  it('Relayed Payment execution results in ERC20 received by Payments contract', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(Number(await erc20.balanceOf(payments.address)), paymentData.amount);
  });

  it('Relayed Payment execution fails if deadline to pay expired', async () => {
    await timeTravel.wait(timeToPay + 10);
    await truffleAssert.reverts(
      executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator),
      'payment deadline expired',
    );
  });

  it('Relayed Payment info is stored corectly', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    const info = await payments.paymentInfo(paymentData.paymentId);
    assert.equal(info.state, ASSET_TRANSFERRING);
    assert.equal(info.buyer, paymentData.buyer);
    assert.equal(info.seller, paymentData.seller);
    assert.equal(info.operator, operator);
    assert.equal(info.feesCollector, feesCollector);
    assert.equal(Number(info.expirationTime) > 100, true);
    assert.equal(Number(info.feeBPS) > 1, true);
    assert.equal(info.amount, paymentData.amount);
  });

  it('Events are emitted in a relayedPay', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    const past = await payments.getPastEvents('Payin', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);
    assert.equal(past[0].args.seller, paymentData.seller);
  });

  it('Events are emitted in a direct pay', async () => {
    await executeDirectPay(paymentData, initialBuyerERC20, initialBuyerETH);
    const past = await payments.getPastEvents('Payin', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);
    assert.equal(past[0].args.seller, paymentData.seller);
  });

  it('Direct Buyer Payment execution results in ERC20 received by Payments contract', async () => {
    await executeDirectPay(paymentData, initialBuyerERC20, initialBuyerETH);
    assert.equal(Number(await erc20.balanceOf(payments.address)), paymentData.amount);
  });

  it('Direct Buyer Payment execution fails if deadline to pay expired', async () => {
    await timeTravel.wait(timeToPay + 10);
    await truffleAssert.reverts(
      executeDirectPay(paymentData, initialBuyerERC20, initialBuyerETH),
      'payment deadline expired',
    );
  });

  it('Direct by buyer payment is stored corectly', async () => {
    await executeDirectPay(paymentData, initialBuyerERC20, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    const info = await payments.paymentInfo(paymentData.paymentId);
    assert.equal(info.state, ASSET_TRANSFERRING);
    assert.equal(info.buyer, paymentData.buyer);
    assert.equal(info.seller, paymentData.seller);
    assert.equal(info.operator, operatorAccount.address);
    assert.equal(Number(info.expirationTime) > 100, true);
    assert.equal(Number(info.feeBPS) > 1, true);
    assert.equal(info.amount, paymentData.amount);
  });

  it('Sellers can register', async () => {
    assert.equal(await payments.isRegisteredSeller(alice), false);
    await payments.registerAsSeller({ from: alice }).should.be.fulfilled;
    assert.equal(await payments.isRegisteredSeller(alice), true);

    // check event:
    const past = await payments.getPastEvents('NewSeller', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.seller, alice);
  });

  it('ERC20 deploys with expected storage', async () => {
    assert.equal(await erc20.name(), name);
    assert.equal(await erc20.symbol(), symbol);
    const expectedERC20Deployer = toBN(100000000000000000000 - initialOperatorERC20);
    assert.equal(Number(await erc20.balanceOf(deployer)), Number(expectedERC20Deployer));
  });

  it('Payments deploys with expected storage', async () => {
    assert.equal(await payments.isSellerRegistrationRequired(), false);
    assert.equal(await payments.acceptedCurrency(), CURRENCY_DESCRIPTOR);
    assert.equal(await payments.defaultOperator(), accounts[0]);
    assert.equal(await payments.defaultFeesCollector(), accounts[0]);
    assert.equal(await payments.owner(), accounts[0]);
    assert.equal(await payments.erc20(), erc20.address);
    assert.equal(Number(await payments.paymentWindow()), 30 * 24 * 3600);
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), 0);
    assert.equal(Number(await payments.balanceOf(paymentData.buyer)), 0);
    // Contact initially holds no funds
    assert.equal(Number(await erc20.balanceOf(payments.address)), 0);
    assert.equal(Number(await payments.erc20BalanceOf(payments.address)), 0);
    const expectedERC20Deployer = toBN(100000000000000000000 - initialOperatorERC20);
    assert.equal(Number(await payments.erc20BalanceOf(deployer)), Number(expectedERC20Deployer));
  });

  it('Set isSellerRegistrationRequired', async () => {
    await truffleAssert.reverts(
      payments.setIsSellerRegistrationRequired(false, { from: alice }),
      'caller is not the owner',
    );
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    assert.equal(await payments.isSellerRegistrationRequired(), true);
  });

  it('Set payment window', async () => {
    const newVal = 12345;
    await truffleAssert.reverts(
      payments.setPaymentWindow(newVal, { from: alice }),
      'caller is not the owner',
    );
    await payments.setPaymentWindow(newVal, { from: deployer }).should.be.fulfilled;
    assert.equal(Number(await payments.paymentWindow()), newVal);

    // check event
    const past = await payments.getPastEvents('PaymentWindow', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.window, newVal);
  });

  it('Test fee computation', async () => {
    assert.equal(Number(await payments.computeFeeAmount(9, 500)), 0);
    assert.equal(Number(await payments.computeFeeAmount(99, 100)), 0);
    assert.equal(Number(await payments.computeFeeAmount(100, 100)), 1);
    assert.equal(Number(await payments.computeFeeAmount(100, 500)), 5);
    assert.equal(Number(await payments.computeFeeAmount(123456, 7)), 86);
    assert.equal(Number(await payments.computeFeeAmount('1234560000000000000000', 10)), 1234560000000000000);
  });

  it('Test splitFundingSources with no local balance', async () => {
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), 0);

    let split = await payments.splitFundingSources(paymentData.seller, 0);
    assert.equal(Number(split.externalFunds), 0);
    assert.equal(Number(split.localFunds), 0);

    split = await payments.splitFundingSources(paymentData.seller, 10);
    assert.equal(Number(split.externalFunds), 10);
    assert.equal(Number(split.localFunds), 0);
  });

  it('Test splitFundingSources with non-zero local balance', async () => {
    // First complete a sell, so that seller has local balance
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const localFunds = toBN(Number(paymentData.amount) - feeAmount);
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), localFunds);

    // when amount is larger than local funds:
    let amount = localFunds.add(toBN(5));
    let split = await payments.splitFundingSources(paymentData.seller, amount);
    assert.equal(Number(split.externalFunds), 5);
    assert.equal(Number(split.localFunds), Number(localFunds));
    assert.equal(Number(split.externalFunds) + Number(split.localFunds), amount);

    // when amount is less than local funds:
    amount = localFunds.sub(toBN(5));
    split = await payments.splitFundingSources(paymentData.seller, amount);
    assert.equal(Number(split.externalFunds), 0);
    assert.equal(Number(split.localFunds), Number(amount));
    assert.equal(Number(split.externalFunds) + Number(split.localFunds), amount);
  });

  it('Payments with 0 amount are accepted', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.amount = 0;
    await executeRelayedPay(paymentData2, initialBuyerERC20, initialBuyerETH, operator);
  });

  it('checkPaymentInputs fails on bad fees value', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.feeBPS = 10001;
    await truffleAssert.reverts(
      executeRelayedPay(paymentData2, initialBuyerERC20, initialBuyerETH, operator),
      'fee cannot be larger than 100 percent',
    );
  });

  it('checkPaymentInputs fails on bad fees value', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.deadline = 1;
    await truffleAssert.reverts(
      executeRelayedPay(paymentData2, initialBuyerERC20, initialBuyerETH, operator),
      'payment deadline expired',
    );
  });

  it('checkPaymentInputs fails on bad fees value', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.deadline = 1;
    await truffleAssert.reverts(
      executeRelayedPay(paymentData2, initialBuyerERC20, initialBuyerETH, operator),
      'payment deadline expired',
    );
  });

  it('enoughFundsAvailable by approving enough ERC20', async () => {
    // initially buyer has no funds anywhere
    assert.equal(await payments.enoughFundsAvailable(paymentData.buyer, 10), false);

    // buyer now has funds in the ERC20 but they are not approved yet
    await erc20.transfer(paymentData.buyer, initialBuyerERC20, { from: deployer });
    assert.equal(await payments.enoughFundsAvailable(paymentData.buyer, 10), false);
    assert.equal(await payments.maxFundsAvailable(paymentData.buyer), 0);

    // buyer now finally approved
    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);
    await erc20.approve(
      payments.address, paymentData.amount, { from: paymentData.buyer },
    );
    assert.equal(await payments.enoughFundsAvailable(paymentData.buyer, 10), true);
    assert.equal(Number(await payments.maxFundsAvailable(paymentData.buyer)), paymentData.amount);
  });

  it('enoughFundsAvailable by approving part in ERC20 and part in local balance', async () => {
    // First complete a sale, so that seller has local balance
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const localFunds = toBN(Number(paymentData.amount) - feeAmount);
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), localFunds);

    // set the total needed to be twice the localFunds available:
    const amount = localFunds.add(localFunds);
    assert.equal(Number(localFunds), 285);
    assert.equal(Number(amount), 2 * 285);

    // check that it returns: still, not enough available:
    assert.equal(await payments.enoughFundsAvailable(paymentData.seller, amount), false);
    assert.equal(Number(await payments.maxFundsAvailable(paymentData.seller)), localFunds);

    // Compute the pending amount required to be approved in the ERC20 contract
    const pendingRequired = amount.sub(localFunds);
    assert.equal(Number(amount), 2 * Number(localFunds));

    // Check that the split computed is as expected
    const split = await payments.splitFundingSources(paymentData.seller, amount);
    assert.equal(Number(split.localFunds), Number(localFunds));
    assert.equal(Number(split.externalFunds), Number(pendingRequired));

    // if seller approved but without actual balance in the ERC20 contract, it still fails
    await erc20.approve(
      payments.address, pendingRequired, { from: paymentData.seller },
    );
    assert.equal(Number(await erc20.balanceOf(paymentData.seller)), 0);
    assert.equal(await payments.enoughFundsAvailable(paymentData.seller, amount), false);
    assert.equal(Number(await payments.maxFundsAvailable(paymentData.seller)), localFunds);

    // it still fails if funds are -1 from required
    await erc20.transfer(paymentData.seller, Number(pendingRequired) - 1, { from: deployer });
    assert.equal(Number(await erc20.balanceOf(paymentData.seller)), Number(pendingRequired) - 1);
    assert.equal(await payments.enoughFundsAvailable(paymentData.seller, amount), false);
    assert.equal(
      Number(await payments.maxFundsAvailable(paymentData.seller)),
      Number(localFunds) + Number(pendingRequired) - 1,
    );

    // it works after actually having the correct balance
    await erc20.transfer(paymentData.seller, 1, { from: deployer });
    assert.equal(Number(await erc20.balanceOf(paymentData.seller)), Number(pendingRequired));
    assert.equal(await payments.enoughFundsAvailable(paymentData.seller, amount), true);
    assert.equal(
      Number(await payments.maxFundsAvailable(paymentData.seller)),
      Number(localFunds) + Number(pendingRequired),
    );
  });
});
