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

contract('CryptoPayments2', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'IBZ ERC20 IN POLYGON';
  const [deployer, alice, bob] = accounts;
  const feesCollector = deployer;
  const buyerPrivKey = '0x3B878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const operatorPrivKey = '0x4A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const buyerAccount = web3.eth.accounts.privateKeyToAccount(buyerPrivKey);
  const operatorAccount = web3.eth.accounts.privateKeyToAccount(operatorPrivKey);
  const operator = operatorAccount.address;
  const name = 'MYERC20';
  const symbol = 'FV20';
  const dummySignature = '0x009a76c8f1c6f4286eb295ddc60d1fbe306880cbc5d36178c67e97d4993d6bfc112c56ff9b4d988af904cd107cdcc61f11461d6a436e986b665bb88e1b6d32c81c';
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

  async function assertBalances(_contract, addresses, amounts) {
    for (let i = 0; i < addresses.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal(String(await _contract.balanceOf(addresses[i])), String(amounts[i]));
    }
  }

  it('Events are emitted in a direct pay', async () => {
    await executeDirectPay(paymentData, initialBuyerERC20, initialBuyerETH);
    const past = await payments.getPastEvents('Payin', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);
    assert.equal(past[0].args.seller, paymentData.seller);
  });

  it('From PAID: seller can withdraw, all balances work as expected', async () => {
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment thorugh its 'happy path'.
    // Initially:
    // - buyer has no balance in ERC20 contract, nor in Payments contract
    // - deployer has some balance in the ERC20 contract.
    // - ERC20 contract:
    const expectedERC20Buyer = toBN(0);
    let expectedERC20Seller = toBN(0);
    const expectedERC20Operator = await erc20.balanceOf(operator);
    const expectedERC20FeesCollector = await erc20.balanceOf(feesCollector);
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, operator],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the ERC20 contract
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);

    expectedERC20Buyer.iadd(toBN(initialBuyerERC20 - paymentData.amount));
    expectedERC20Operator.isub(toBN(initialBuyerERC20));

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, operator],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the ERC20 contract
    // But the balances in the payments contract reflect the
    // expected seller and feesCollector amounts for later withdrawals
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), PAID);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    expectedPaymentsSeller = toBN(sellerAmount);
    expectedPaymentsFeesCollector = toBN(feeAmount);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, operator],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the ERC20 have gone from buyer to seller fully in the ERC20 contract
    await payments.withdraw({ from: paymentData.seller }).should.be.fulfilled;

    expectedPaymentsSeller = toBN(0);
    expectedERC20Seller = toBN(sellerAmount);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, operator],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, feesCollector can withdraw too, leaving zero balances in the payments contract
    // and the expected amounts in the ERC20 contract.
    await payments.withdraw({ from: feesCollector }).should.be.fulfilled;

    expectedPaymentsFeesCollector = toBN(0);
    expectedERC20FeesCollector.iadd(toBN(feeAmount));

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('Repeated payments lead to addition of funds', async () => {
    const expectedERC20FeesCollector = await erc20.balanceOf(feesCollector);

    // We will do 2 payments with equal seller, and 1 with a different seller (Bob)
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.paymentId = '0xa884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';
    await executeRelayedPay(paymentData2, initialBuyerERC20, initialBuyerETH, operator);
    const paymentData3 = JSON.parse(JSON.stringify(paymentData));
    paymentData3.paymentId = '0xe884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';
    paymentData3.seller = bob;
    await executeRelayedPay(paymentData3, initialBuyerERC20, initialBuyerETH, operator);

    await finalize(paymentData.paymentId, true, operatorPrivKey);
    await finalize(paymentData2.paymentId, true, operatorPrivKey);
    await finalize(paymentData3.paymentId, true, operatorPrivKey);

    await payments.withdraw({ from: feesCollector });
    await payments.withdraw({ from: paymentData.seller });
    await payments.withdraw({ from: bob });

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    // the feescollector has collected 3 fees
    expectedERC20FeesCollector.iadd(toBN(3 * feeAmount));
    expectedERC20Seller = toBN(2 * sellerAmount);
    expectedERC20Bob = toBN(sellerAmount);

    await assertBalances(
      erc20,
      [paymentData.seller, bob, feesCollector],
      [expectedERC20Seller, expectedERC20Bob, expectedERC20FeesCollector],
    );
  });

  it('From PAID: no further action is accepted', async () => {
    const signature = await executeRelayedPay(
      paymentData, initialBuyerERC20, initialBuyerETH, operator,
    );
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    // try assetTransferSuccess
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    // try assetTransferFails
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    // try to pay again
    await erc20.approve(
      payments.address, paymentData.amount, { from: paymentData.buyer },
    ).should.be.fulfilled;

    await truffleAssert.reverts(
      payments.relayedPay(paymentData, signature, { from: operator }),
      'payment in incorrect curent state',
    );
  });

  it('From ASSET_TRANSFER: buyer is refunded when asset transfer fails', async () => {
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment thorugh its 'happy path'.

    // Initially:
    // - buyer has no balance in ERC20 contract, nor in Payments contract
    // - deployer has some balance in the ERC20 contract.
    // - ERC20 contract:
    const expectedERC20Buyer = toBN(0);
    const expectedERC20Seller = toBN(0);
    const expectedERC20FeesCollector = await erc20.balanceOf(feesCollector);
    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the ERC20 contract
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);

    expectedERC20Buyer.iadd(toBN(initialBuyerERC20 - paymentData.amount));

    // When payment moves to REFUNDED, balances have been updated with buyer's refund:
    await finalize(paymentData.paymentId, false, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);

    // Check BuyerRefund event:
    const past = await payments.getPastEvents('BuyerRefunded', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);

    expectedPaymentsBuyer = toBN(paymentData.amount);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdrawal, she sees the tokens back in the ERC20 contract
    await payments.withdraw({ from: paymentData.buyer }).should.be.fulfilled;

    // Check withdraw event:
    const past2 = await payments.getPastEvents('Withdraw', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past2[0].args.user, paymentData.buyer);
    assert.equal(past2[0].args.amount, paymentData.amount);

    expectedERC20Buyer.iadd(toBN(paymentData.amount));
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('From expired: buyer can withdraw', async () => {
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment thorugh its 'happy path'.

    // Initially:
    // - buyer has no balance in ERC20 contract, nor in Payments contract
    // - deployer has some balance in the ERC20 contract.
    const expectedERC20Buyer = toBN(0);
    const expectedERC20Seller = toBN(0);
    const expectedERC20FeesCollector = await erc20.balanceOf(feesCollector);
    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the ERC20 contract
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);

    expectedERC20Buyer.iadd(toBN(initialBuyerERC20 - paymentData.amount));

    // Let's move to FAILED by going beyond expiration time:
    const paymentWindow = await payments.paymentWindow();
    // wait just before expiration time, and check that state has not changed yet
    await timeTravel.wait(Number(paymentWindow) + 10);

    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);

    // note that anyone can do this, not necessarily the interested party:
    await payments.refund(paymentData.paymentId, { from: bob }).should.be.fulfilled;

    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);

    // only the samll unused amount should remain as local balance
    expectedPaymentsBuyer = toBN(paymentData.amount);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdraw, buyer sees the tokens back in the ERC20 contract
    await payments.withdraw({ from: paymentData.buyer }).should.be.fulfilled;

    expectedERC20Buyer.iadd(expectedPaymentsBuyer);
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      erc20,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('finalize: only operator is authorized to sign', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, buyerPrivKey),
      'only the operator can sign an assetTransferResult',
    );
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, false, buyerPrivKey),
      'only the operator can sign an assetTransferResult',
    );
  });

  it('ASSET_TRANSFERRING moves to PAID when someone relays operator confirmation of asset transfer success', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), PAID);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    await assertBalances(
      payments,
      [paymentData.seller, feesCollector],
      [sellerAmount, feeAmount],
    );

    // Check PAY event
    const past = await payments.getPastEvents('Paid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
  });

  it('ASSET_TRANSFERRING moves to REFUNDED when someone realays operator confirmation of asset transfer failed', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await finalize(paymentData.paymentId, false, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);

    // check event
    const past = await payments.getPastEvents('BuyerRefunded', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);
  });

  it('From NOT_STARTED: not possible to confirm asset transfer failure or success', async () => {
    assert.equal(await payments.paymentState(paymentData.paymentId), NOT_STARTED);

    // Fails to recognize operator because all paymentData have been deleted
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, false, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
  });

  it('ASSET_TRANSFERRING allows ACCEPTS_REFUND after expiration time', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    const paymentWindow = await payments.paymentWindow();
    // wait just before expiration time, and check that state has not changed yet
    await timeTravel.wait(Number(paymentWindow) - 100);
    assert.equal(await payments.acceptsRefunds(paymentData.paymentId), false);
    // wait the remainder period to get beyond expiration time,
    await timeTravel.wait(101);
    assert.equal(await payments.acceptsRefunds(paymentData.paymentId), true);
    // note that the written state has not changed, though:
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
  });

  it('ACCEPTS_REFUNDS: anyone can refundAndWithdraw in one transaction', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    // wait beyond payment window to move to FAILED
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.wait(Number(paymentWindow) + 5);
    assert.equal(await payments.acceptsRefunds(paymentData.paymentId), true);
    // Check expected ERC20 of buyer before refunding:
    const expectedERC20Buyer = toBN(initialBuyerERC20 - paymentData.amount);
    await assertBalances(erc20, [paymentData.buyer], [expectedERC20Buyer]);

    // Anyone can execute refundAndWithdraw. The reason bob fails is that he does not have balance:
    await truffleAssert.reverts(
      payments.refundAndWithdraw(paymentData.paymentId, { from: bob }),
      'cannot withdraw: balance is zero',
    );
    // The buyer can do it because he has balance right after the refund:
    await payments.refundAndWithdraw(
      paymentData.paymentId,
      { from: paymentData.buyer },
    ).should.be.fulfilled;
    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);
    // After refundAndWithdraw: no balance in payments contract, all ERC20 refunded
    expectedERC20Buyer.iadd(toBN(paymentData.amount));
    await assertBalances(payments, [paymentData.buyer], [0]);
    await assertBalances(erc20, [paymentData.buyer], [expectedERC20Buyer]);
  });

  it('ASSET_TRANSFERRING blocks another Relayed Payment', async () => {
    const signature = await executeRelayedPay(
      paymentData, initialBuyerERC20, initialBuyerETH, operator,
    );
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.relayedPay(paymentData, signature, { from: operator }),
      'payment in incorrect curent state',
    );
  });

  it('ASSET_TRANSFERRING blocks another Direct Payment', async () => {
    const signature = await executeRelayedPay(
      paymentData, initialBuyerERC20, initialBuyerETH, operator,
    );
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.pay(paymentData, signature, { from: paymentData.buyer }),
      'payment in incorrect curent state',
    );
  });

  it('ASSET_TRANSFERRING blocks refund', async () => {
    await executeRelayedPay(paymentData, initialBuyerERC20, initialBuyerETH, operator);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.refund(paymentData.paymentId),
      'payment does not accept refunds at this stage',
    );
  });

  it('RelayedPay: if isSellerRegistrationRequired == false, no need to register', async () => {
    await erc20.transfer(paymentData.buyer, 100 * Number(paymentData.amount), { from: deployer });
    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    await erc20.approve(
      payments.address, Number(paymentData.amount), { from: buyerAccount.address },
    ).should.be.fulfilled;

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(buyerPrivKey.slice(2)),
      prepareDataToSignPayment({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: payments.address,
      }),
    );

    // fails unless registration is not required:
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    assert.equal(await payments.isRegisteredSeller(paymentData.seller), false);
    await truffleAssert.reverts(
      payments.relayedPay(paymentData, signature, { from: operator }),
      'seller not registered',
    );
    await payments.setIsSellerRegistrationRequired(false, { from: deployer }).should.be.fulfilled;
    await payments.relayedPay(paymentData, signature, { from: operator }).should.be.fulfilled;
  });

  it('DirectPay: if isSellerRegistrationRequired == false, no need to register', async () => {
    await erc20.transfer(paymentData.buyer, 100 * Number(paymentData.amount), { from: deployer });
    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    await erc20.approve(
      payments.address, Number(paymentData.amount), { from: buyerAccount.address },
    ).should.be.fulfilled;

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignPayment({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: payments.address,
      }),
    );

    // fails unless registration is not required:
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    assert.equal(await payments.isRegisteredSeller(paymentData.seller), false);
    await truffleAssert.reverts(
      payments.pay(paymentData, signature, { from: paymentData.buyer }),
      'seller not registered',
    );
    await payments.setIsSellerRegistrationRequired(false, { from: deployer }).should.be.fulfilled;
    await payments.pay(paymentData, signature, { from: paymentData.buyer }).should.be.fulfilled;
  });

  it('RelayedPay requirements are correctly checked', async () => {
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    // This test checks the fulfilment of all requirements to accept a payment
    // By starting with not fulfiling any, checking revert messages, then
    // fulfilling one & checking new revert message, etc., until accepted.

    // Carol will be the buyer:
    assert.equal(paymentData.buyer, buyerAccount.address);
    // Start by funding Carol with ERC20 so that she can buy
    await erc20.transfer(paymentData.buyer, 100 * Number(paymentData.amount), { from: deployer });
    // And also funding Carol with ETH so that she can approve
    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    // should fail unless seller is registerd
    await truffleAssert.reverts(
      payments.relayedPay(paymentData, dummySignature, { from: operator }),
      'seller not registered',
    );
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;

    // should fail unless buyer has approved an allowance to the payments contract
    await truffleAssert.reverts(
      payments.relayedPay(paymentData, dummySignature, { from: operator }),
      'not enough funds available for this buyer',
    );

    // try allowing 1 less than required:
    assert.equal(Number(await erc20.allowance(paymentData.buyer, payments.address)), 0);
    await erc20.approve(
      payments.address, Number(paymentData.amount) - 1, { from: buyerAccount.address },
    ).should.be.fulfilled;

    await truffleAssert.reverts(
      payments.relayedPay(paymentData, dummySignature, { from: operator }),
      'not enough funds available for this buyer',
    );

    // allow enough:
    await erc20.approve(
      payments.address, paymentData.amount, { from: paymentData.buyer },
    ).should.be.fulfilled;
    assert.equal(
      Number(await erc20.allowance(paymentData.buyer, payments.address)),
      paymentData.amount,
    );

    // fails unless fee is below 100%
    const wrongPaymentData2 = JSON.parse(JSON.stringify(paymentData));
    wrongPaymentData2.feeBPS = 10100;
    await truffleAssert.reverts(
      payments.relayedPay(wrongPaymentData2, dummySignature, { from: operator }),
      'fee cannot be larger than 100 percent',
    );

    // fails unless correctly signed by buyer
    await truffleAssert.reverts(
      payments.relayedPay(paymentData, dummySignature, { from: operator }),
      'incorrect buyer signature',
    );
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(buyerPrivKey.slice(2)),
      prepareDataToSignPayment({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: payments.address,
      }),
    );

    // fails unless operator is authorized
    await truffleAssert.reverts(
      payments.relayedPay(paymentData, signature, { from: buyerAccount.address }),
      'operator not authorized for this universeId',
    );

    // it finally is accepted
    await payments.relayedPay(paymentData, signature, { from: operator }).should.be.fulfilled;
  });

  it('Direct pay executed by buyer requirements are correctly checked', async () => {
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    // This test checks the fulfilment of all requirements to accept a payment
    // By starting with not fulfiling any, checking revert messages, then
    // fulfilling one & checking new revert message, etc., until accepted.

    // Carol will be the buyer:
    assert.equal(paymentData.buyer, buyerAccount.address);
    // Start by funding Carol with ERC20 so that she can buy
    await erc20.transfer(paymentData.buyer, 100 * Number(paymentData.amount), { from: deployer });
    // And also funding Carol with ETH so that she can approve
    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    // should fail unless the buyer is the sender of the TX
    await truffleAssert.reverts(
      payments.pay(paymentData, dummySignature, { from: operator }),
      'only buyer can execute this function',
    );

    // should fail unless seller is registered
    await truffleAssert.reverts(
      payments.pay(paymentData, dummySignature, { from: paymentData.buyer }),
      'seller not registered',
    );
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;

    // should fail unless buyer has approved an allowance to the payments contract
    await truffleAssert.reverts(
      payments.pay(paymentData, dummySignature, { from: paymentData.buyer }),
      'not enough funds available for this buyer',
    );

    // try allowing 1 less than required:
    assert.equal(Number(await erc20.allowance(paymentData.buyer, payments.address)), 0);
    await erc20.approve(
      payments.address, Number(paymentData.amount) - 1, { from: paymentData.buyer },
    ).should.be.fulfilled;

    await truffleAssert.reverts(
      payments.pay(paymentData, dummySignature, { from: paymentData.buyer }),
      'not enough funds available for this buyer',
    );

    // allow enough:
    await erc20.approve(
      payments.address, paymentData.amount, { from: paymentData.buyer },
    ).should.be.fulfilled;
    assert.equal(
      Number(await erc20.allowance(paymentData.buyer, payments.address)),
      paymentData.amount,
    );

    // fails unless fee is below 100%
    const wrongPaymentData2 = JSON.parse(JSON.stringify(paymentData));
    wrongPaymentData2.feeBPS = 10100;
    await truffleAssert.reverts(
      payments.pay(wrongPaymentData2, dummySignature, { from: paymentData.buyer }),
      'fee cannot be larger than 100 percent',
    );

    // fails unless the operator signature is provided
    await truffleAssert.reverts(
      payments.pay(paymentData, dummySignature, { from: paymentData.buyer }),
      'incorrect operator signature',
    );

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignPayment({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: payments.address,
      }),
    );

    // it finally is accepted
    await payments.pay(paymentData, signature, { from: paymentData.buyer }).should.be.fulfilled;
  });
});
