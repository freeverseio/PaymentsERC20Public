# Payments in Crypto - Solidity Contract


## Install and tests
```
npm ci 
npm test
```


## Description

```
/**
 * @dev Upon transfer of ERC20 tokens to this contract, these remain
 * locked until an Operator confirms the success of failure of the
 * asset transfer required to fulfil this payment.
 *
 * If no confirmation is recevied from the operator during the PaymentWindow,
 * all of buyer's received tokens are made available to the buyer for refund.
 *
 * To start a payment, the signatures of both the buyer and the Operator are required.
 * - in the 'relayedPay' method, the Operator is the msg.sender, and the buyerSig is provided;
 * - in the 'pay' method, the buyer is the msg.sender, and the operatorSig is provided.
 *
 * This contract maintains the balances of all users, it does not transfer them automatically.
 * Users need to explicitly call the 'withdraw' method, which withdraws balanceOf[msg.sender]
 * If a buyer has non-zero local balance at the moment of starting a new payment, 
 * the contract reuses it, and only transfers the remainder required (if any) 
 * from the external ERC20 contract. 
 *
 * Each payment has the following States Machine:
 * - NOT_STARTED -> ASSET_TRANSFERRING, triggered by pay/relayedPay
 * - ASSET_TRANSFERRING -> PAID, triggered by relaying assetTransferSuccess signed by operator
 * - ASSET_TRANSFERRING -> REFUNDED, triggered by relaying assetTransferFailed signed by operator
 * - ASSET_TRANSFERRING -> REFUNDED, triggered by a refund request after expirationTime
 *
 * NOTE: To ensure that the a payment process proceeds as expected when the payment starts,
 * upon acceptance of a pay/relayedPay, the following data: {operator, feesCollector, expirationTime}
 * is stored in the payment struct, and used throught the payment, regardless of
 * any possible modifications to the contract's storage.
 *
 */
```

## States Machine

![StateMachine](./imgs/crypto_payment.png)


## UML Diagram

![UML](./imgs/PaymentsERC20.svg)
