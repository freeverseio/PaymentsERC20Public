// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./FeesCollectors.sol";
import "./EIP712Verifier.sol";

/**
 * @title Interface to Payments Contract in ERC20.
 * @author Freeverse.io, www.freeverse.io
 * @dev Upon transfer of ERC20 tokens to this contract, these remain
 * locked until an Operator confirms the success of failure of the
 * asset transfer required to fulfil this payment.
 *
 * If no confirmation is received from the operator during the PaymentWindow,
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

import "./IEIP712Verifier.sol";

interface IPaymentsERC20 is IEIP712Verifier {
    event PaymentWindow(uint256 window);
    event NewSeller(address indexed seller);
    event BuyerRefunded(bytes32 indexed paymentId, address indexed buyer);
    event Payin(
        bytes32 indexed paymentId,
        address indexed buyer,
        address indexed seller
    );
    event Paid(bytes32 indexed paymentId);
    event Withdraw(address indexed user, uint256 amount);

    enum States {
        NotStarted,
        AssetTransferring,
        Refunded,
        Paid
    }

    /**
     * @notice Main struct stored with every payment.
     *  feeBPS is the percentage fee expressed in Basis Points (bps), typical in finance
     *  Examples:  2.5% = 250 bps, 10% = 1000 bps, 100% = 10000 bps
     */
    struct Payment {
        States state;
        address buyer;
        address seller;
        address operator;
        address feesCollector;
        uint256 expirationTime;
        uint16 feeBPS;
        uint256 amount;
    }

    /**
     * @notice Registers msg.sender as seller so that he/she can accept payments.
     */
    function registerAsSeller() external;

    /**
     * @notice Starts the Payment process via relay-by-operator.
     * @dev Executed by an operator, who relays the MetaTX with the buyer's signature.
     *  The buyer must have approved the amount to this contract before.
     *  If all requirements are fulfilled, it stores the data relevant
     *  for the next steps of the payment, and it locks the ERC20
     *  in this contract.
     *  Follows standard Checks-Effects-Interactions pattern
     *  to protect against re-entrancy attacks.
     *  Moves payment to ASSET_TRANSFERRING state.
     * @param inp The struct containing all required payment data
     * @param buyerSignature The signature of 'inp' by the buyer
     */
    function relayedPay(
        PaymentInput calldata inp,
        bytes calldata buyerSignature
    ) external;

    /**
     * @notice Starts Payment process directly by the buyer.
     * @dev Executed by the buyer, who relays the MetaTX with the operator's signature.
     *  The buyer must have approved the amount to this contract before.
     *  If all requirements are fulfilled, it stores the data relevant
     *  for the next steps of the payment, and it locks the ERC20
     *  in this contract.
     *  Follows standard Checks-Effects-Interactions pattern
     *  to protect against re-entrancy attacks.
     *  Moves payment to ASSET_TRANSFERRING state.
     * @param inp The struct containing all required payment data
     * @param operatorSignature The signature of 'inp' by the operator
     */
    function pay(PaymentInput calldata inp, bytes calldata operatorSignature)
        external;

    /**
     * @notice Relays the operator signature declaring that the asset transfer was successful or failed,
     *  and updates balances of seller or buyer, respectively.
     * @dev Can be executed by anyone, but the operator signature must be included as input param.
     *  Seller or Buyer's balances are updated, allowing explicit withdrawal.
     *  Moves payment to PAID or REFUNDED state on transfer success/failure, respectively.
     * @param result The asset transfer result struct signed by the operator.
     * @param operatorSignature The operator signature of result
     */
    function finalize(
        AssetTransferResult calldata result,
        bytes calldata operatorSignature
    ) external;

    /**
     * @notice Relays the operator signature declaring that the asset transfer was successful or failed,
     *  updates balances of seller or buyer, respectively,
     *  and proceeds to withdraw all funds in this contract available to msg.sender.
     * @dev Can be executed by anyone, but the operator signature must be included as input param.
     *  It is, however, expected to be executed by the seller, in case of a successful asset transfer,
     *  or the buyer, in case of a failed asset transfer.
     *  Moves payment to PAID or REFUNDED state on transfer success/failure, respectively.
     * @param result The asset transfer result struct signed by the operator.
     * @param operatorSignature The operator signature of result
     */
    function finalizeAndWithdraw(
        AssetTransferResult calldata result,
        bytes calldata operatorSignature
    ) external;

    /**
     * @notice Moves buyer's provided funds to buyer's balance.
     * @dev Anybody can call this function.
     *  Requires acceptsRefunds == true to proceed.
     *  After updating buyer's balance, he/she can later withdraw.
     *  Moves payment to REFUNDED state.
     * @param paymentId The unique ID that identifies the payment.
     */
    function refund(bytes32 paymentId) external;

    /**
     * @notice Executes refund and withdraw in one transaction.
     * @dev Anybody can call this function.
     *  Requires acceptsRefunds == true to proceed.
     *  All of msg.sender's balance in the contract is withdrawn,
     *  not only the part that was locked in this particular paymentId
     *  Moves payment to REFUNDED state.
     * @param paymentId The unique ID that identifies the payment.
     */
    function refundAndWithdraw(bytes32 paymentId) external;

    /**
     * @notice Transfers ERC20 avaliable in this
     *  contract's balanceOf[msg.sender] to msg.sender
     */
    function withdraw() external;

    // VIEW FUNCTIONS

    /**
     * @notice Returns whether sellers need to be registered to be able to accept payments
     * @return Returns true if sellers need to be registered to be able to accept payments
     */
    function isSellerRegistrationRequired() external view returns (bool);

    /**
     * @notice Returns true if the address provided is a registered seller
     * @param addr the address that is queried
     * @return Returns whether the address is registered as seller
     */
    function isRegisteredSeller(address addr) external view returns (bool);

    /**
     * @notice Returns the address of the ERC20 contract from which
     *  tokens are accepted for payments
     * @return the address of the ERC20 contract
     */
    function erc20() external view returns (address);

    /**
     * @notice Returns the local ERC20 balance of the provided address
     *  that is stored in this contract, and hence, available for withdrawal.
     * @param addr the address that is queried
     * @return the local balance
     */
    function balanceOf(address addr) external view returns (uint256);

    /**
     * @notice Returns the ERC20 balance of address in the ERC20 contract
     * @param addr the address that is queried
     * @return the balance in the external ERC20 contract
     */
    function erc20BalanceOf(address addr) external view returns (uint256);

    /**
     * @notice Returns the allowance that the buyer has approved
     *  directly in the ERC20 contract in favour of this contract.
     * @param buyer the address of the buyer
     * @return the amount allowed by buyer
     */
    function allowance(address buyer) external view returns (uint256);

    /**
     * @notice Returns all data stored in a payment
     * @param paymentId The unique ID that identifies the payment.
     * @return the struct stored for the payment
     */
    function paymentInfo(bytes32 paymentId)
        external
        view
        returns (Payment memory);

    /**
     * @notice Returns the state of a payment.
     * @dev If payment is in ASSET_TRANSFERRING, it may be worth
     *  checking acceptsRefunds ot check if it has gone beyond expirationTime.
     * @param paymentId The unique ID that identifies the payment.
     * @return the state of the payment.
     */
    function paymentState(bytes32 paymentId) external view returns (States);

    /**
     * @notice Returns true if the payment accepts a refund to the buyer
     * @dev The payment must be in ASSET_TRANSFERRING and beyond expirationTime.
     * @param paymentId The unique ID that identifies the payment.
     * @return true if the payment accepts a refund to the buyer.
     */
    function acceptsRefunds(bytes32 paymentId) external view returns (bool);

    /**
     * @notice Returns the amount of seconds that a payment
     *  can remain in ASSET_TRANSFERRING state without positive
     *  or negative confirmation by the operator
     * @return the payment window in secs
     */
    function paymentWindow() external view returns (uint256);

    /**
     * @notice Returns a descriptor about the currency that this contract accepts
     * @return the string describing the currency
     */
    function acceptedCurrency() external view returns (string memory);

    /**
     * @notice Returns true if the 'amount' required for a payment is available to this contract.
     * @dev In more detail: returns true if the sum of the buyer's local balance in this contract,
     *  plus funds available and approved in the ERC20 contract, are larger or equal than 'amount'
     * @param buyer The address for which funds are queried
     * @param amount The amount that is queried
     * @return Returns true if enough funds are available
     */
    function enoughFundsAvailable(address buyer, uint256 amount)
        external
        view
        returns (bool);

    /**
     * @notice Returns the maximum amount of funds available to a buyer
     * @dev In more detail: returns the sum of the buyer's local balance in this contract,
     *  plus the funds available and approved in the ERC20 contract.
     * @param buyer The address for which funds are queried
     * @return the max funds available
     */
    function maxFundsAvailable(address buyer) external view returns (uint256);

    /**
     * @notice Splits the funds required to pay 'amount' into two sources:
     *  - externalFunds: the amount of ERC20 required to be transferred from the external ERC20 contract
     *  - localFunds: the amount of ERC20 from the buyer's already available balance in this contract.
     * @param buyer The address for which the amount is to be split
     * @param amount The amount to be split
     * @return externalFunds The amount of ERC20 required from the external ERC20 contract.
     * @return localFunds The amount of ERC20 local funds required.
     */
    function splitFundingSources(address buyer, uint256 amount)
        external
        view
        returns (uint256 externalFunds, uint256 localFunds);

    /**
     * @notice Reverts unless the requirements for a PaymentInput that
     *  are common to both pay and relayedPay are fulfilled.
     * @param inp The PaymentInput struct
     */
    function checkPaymentInputs(PaymentInput calldata inp) external view;

    // PURE FUNCTIONS

    /**
     * @notice Safe computation of fee amount for a provided amount, feeBPS pair
     * @dev Must return a value that is guaranteed to be less or equal to the provided amount
     * @param amount The amount
     * @param feeBPS The percentage fee expressed in Basis Points (bps).
     *  feeBPS examples:  2.5% = 250 bps, 10% = 1000 bps, 100% = 10000 bps
     * @return The fee amount
     */
    function computeFeeAmount(uint256 amount, uint256 feeBPS)
        external
        pure
        returns (uint256);
}
