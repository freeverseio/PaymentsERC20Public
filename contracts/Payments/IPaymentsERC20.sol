// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./FeesCollectors.sol";
import "./EIP712Verifier.sol";
import "./IEIP712Verifier.sol";

/**
 * @title Interface to Payments Contract in ERC20.
 * @author Freeverse.io, www.freeverse.io
 * @dev Upon transfer of ERC20 tokens to this contract, these remain
 * locked until an Operator confirms the success or failure of the
 * asset transfer required to fulfil this payment.
 *
 * If no confirmation is received from the operator during the PaymentWindow,
 * all tokens received from the buyer are made available to the buyer for refund.
 *
 * To start a payment, one of the following two methods needs to be called:
 * - in the 'pay' method, the buyer is the msg.sender (the buyer therefore signs the TX),
 *   and the operator's EIP712-signature of the PaymentInput struct is provided as input to the call.
 * - in the 'relayedPay' method, the operator is the msg.sender (the operator therefore signs the TX),
 *   and the buyer's EIP712-signature of the PaymentInput struct is provided as input to the call.
 *
 * This contract maintains the balances of all users, it does not transfer them automatically.
 * Users need to explicitly call the 'withdraw' method, which withdraws balanceOf[msg.sender]
 * If a buyer has a non-zero local balance at the moment of starting a new payment,
 * the contract reuses it, and only transfers the remainder required (if any)
 * from the external ERC20 contract.
 *
 * Each payment has the following State Machine:
 * - NOT_STARTED -> ASSET_TRANSFERRING, triggered by pay/relayedPay
 * - ASSET_TRANSFERRING -> PAID, triggered by relaying assetTransferSuccess signed by operator
 * - ASSET_TRANSFERRING -> REFUNDED, triggered by relaying assetTransferFailed signed by operator
 * - ASSET_TRANSFERRING -> REFUNDED, triggered by a refund request after expirationTime
 *
 * NOTE: To ensure that the payment process proceeds as expected when the payment starts,
 * upon acceptance of a pay/relayedPay, the following data: {operator, feesCollector, expirationTime}
 * is stored in the payment struct, and used throughout the payment, regardless of
 * any possible modifications to the contract's storage.
 *
 */

interface IPaymentsERC20 is IEIP712Verifier {
    /**
     * @dev Event emitted on change of payment window
     * @param window The new amount of time after the arrival of a payment for which, 
     *  in absence of confirmation of asset transfer success, a buyer is allowed to refund
     */
    event PaymentWindow(uint256 window);

    /**
     * @dev Event emitted when a user executes the registerAsSeller method
     * @param seller The address of the newly registeredAsSeller user.
     */
    event NewSeller(address indexed seller);

    /**
     * @dev Event emitted when a buyer is refunded for a given payment process
     * @param paymentId The id of the already initiated payment 
     * @param buyer The address of the refunded buyer
     */
    event BuyerRefunded(bytes32 indexed paymentId, address indexed buyer);

    /**
     * @dev Event emitted when funds for a given payment arrive to this contract
     * @param paymentId The unique id identifying the payment 
     * @param buyer The address of the buyer providing the funds
     * @param seller The address of the seller of the asset
     */
    event PayIn(
        bytes32 indexed paymentId,
        address indexed buyer,
        address indexed seller
    );

    /**
     * @dev Event emitted when a payment process arrives at the PAID 
     *  final state, where the seller receives the funds.
     * @param paymentId The id of the already initiated payment 
     */
    event Paid(bytes32 indexed paymentId);

    /**
     * @dev Event emitted when user withdraws funds from this contract
     * @param user The address of the user that withdraws
     * @param amount The amount withdrawn, in lowest units of the ERC20 token
     */
    event Withdraw(address indexed user, uint256 amount);

    /**
     * @dev The enum characterizing the possible states of a payment process
     */
    enum State {
        NotStarted,
        AssetTransferring,
        Refunded,
        Paid
    }

    /**
     * @notice Main struct stored with every payment.
     *  All variables of the struct remain immutable throughout a payment process
     *  except for `state`.
     */
    struct Payment {
        // the current state of the payment process
        State state;

        // the buyer, providing the required funds, who shall receive
        // the asset on a successful payment.
        address buyer;

        // the seller of the asset, who shall receive the funds
        // (subtracting fees) on a successful payment.        
        address seller;

        // The address of the operator of this payment
        address operator;

        // The address of the feesCollector of this payment
        address feesCollector;

        // The timestamp after which, in absence of confirmation of 
        // asset transfer success, a buyer is allowed to refund
        uint256 expirationTime;

        // the percentage fee expressed in Basis Points (bps), typical in finance
        // Examples:  2.5% = 250 bps, 10% = 1000 bps, 100% = 10000 bps
        uint16 feeBPS;

        // the price of the asset, an integer expressed in the
        // lowest unit of the ERC20 token.
        uint256 amount;
    }

    /**
     * @notice Registers msg.sender as seller so that, if the contract has set
     *  _isSellerRegistrationRequired = true, then payments will be accepted with
     *  msg.sender as seller.
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
     * @param payInput The struct containing all required payment data
     * @param buyerSignature The signature of 'payInput' by the buyer
     */
    function relayedPay(
        PaymentInput calldata payInput,
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
     * @param payInput The struct containing all required payment data
     * @param operatorSignature The signature of 'payInput' by the operator
     */
    function pay(PaymentInput calldata payInput, bytes calldata operatorSignature)
        external;

    /**
     * @notice Relays the operator signature declaring that the asset transfer was successful or failed,
     *  and updates balances of seller or buyer, respectively.
     * @dev Can be executed by anyone, but the operator signature must be included as input param.
     *  Seller or Buyer's balances are updated, allowing explicit withdrawal.
     *  Moves payment to PAID or REFUNDED state on transfer success/failure, respectively.
     * @param transferResult The asset transfer result struct signed by the operator.
     * @param operatorSignature The operator signature of result
     */
    function finalize(
        AssetTransferResult calldata transferResult,
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
     * @param transferResult The asset transfer result struct signed by the operator.
     * @param operatorSignature The operator signature of result
     */
    function finalizeAndWithdraw(
        AssetTransferResult calldata transferResult,
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
     *  checking acceptsRefunds to check if it has gone beyond expirationTime.
     * @param paymentId The unique ID that identifies the payment.
     * @return the state of the payment.
     */
    function paymentState(bytes32 paymentId) external view returns (State);

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
     * @param payInput The PaymentInput struct
     */
    function checkPaymentInputs(PaymentInput calldata payInput) external view;

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
