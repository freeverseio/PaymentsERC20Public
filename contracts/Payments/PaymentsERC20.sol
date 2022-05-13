// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./FeesCollectors.sol";
import "./EIP712Verifier.sol";

/**
 * @title Payments Contract in ERC20.
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

import "./IPaymentsERC20.sol";

contract PaymentsERC20 is IPaymentsERC20, FeesCollectors, EIP712Verifier {
    address private _erc20;
    string private _acceptedCurrency;
    uint256 private _paymentWindow;
    bool private _isSellerRegistrationRequired;
    mapping(address => bool) private _isRegisteredSeller;
    mapping(bytes32 => Payment) private _payments;
    mapping(address => uint256) private _balanceOf;

    constructor(address erc20Address, string memory currencyDescriptor) {
        _erc20 = erc20Address;
        _acceptedCurrency = currencyDescriptor;
        _paymentWindow = 30 days;
        _isSellerRegistrationRequired = false;
    }

    /**
     * @notice Sets the amount of time available to the operator, after the payment starts,
     *  to confirm either the success or the failure of the asset transfer.
     *  After this time, the payment moves to FAILED, allowing buyer to withdraw.
     * @param window The amount of time available, in seconds.
     */
    function setPaymentWindow(uint256 window) external onlyOwner {
        require(
            (window < 60 days) && (window > 3 hours),
            "payment window outside limits"
        );
        _paymentWindow = window;
        emit PaymentWindow(window);
    }

    /**
     * @notice Sets whether sellers are required to register in this contract before being
     *  able to accept payments.
     * @param isRequired (bool) if true, registration is required.
     */
    function setIsSellerRegistrationRequired(bool isRequired)
        external
        onlyOwner
    {
        _isSellerRegistrationRequired = isRequired;
    }

    /// @inheritdoc IPaymentsERC20
    function registerAsSeller() external {
        _isRegisteredSeller[msg.sender] = true;
        emit NewSeller(msg.sender);
    }

    /// @inheritdoc IPaymentsERC20
    function relayedPay(
        PaymentInput calldata inp,
        bytes calldata buyerSignature
    ) external {
        require(
            universeOperator(inp.universeId) == msg.sender,
            "operator not authorized for this universeId"
        );
        require(
            verifyPayment(inp, buyerSignature, inp.buyer),
            "incorrect buyer signature"
        );
        _processInputPayment(inp, msg.sender);
    }

    /// @inheritdoc IPaymentsERC20
    function pay(PaymentInput calldata inp, bytes calldata operatorSignature)
        external
    {
        require(
            msg.sender == inp.buyer,
            "only buyer can execute this function"
        );
        address operator = universeOperator(inp.universeId);
        require(
            verifyPayment(inp, operatorSignature, operator),
            "incorrect operator signature"
        );
        _processInputPayment(inp, operator);
    }

    /// @inheritdoc IPaymentsERC20
    function finalize(
        AssetTransferResult calldata result,
        bytes calldata operatorSignature
    ) external {
        _finalize(result, operatorSignature);
    }

    /// @inheritdoc IPaymentsERC20
    function finalizeAndWithdraw(
        AssetTransferResult calldata result,
        bytes calldata operatorSignature
    ) external {
        _finalize(result, operatorSignature);
        _withdraw();
    }

    /// @inheritdoc IPaymentsERC20
    function refund(bytes32 paymentId) public {
        _refund(paymentId);
    }

    /// @inheritdoc IPaymentsERC20
    function refundAndWithdraw(bytes32 paymentId) external {
        _refund(paymentId);
        _withdraw();
    }

    /// @inheritdoc IPaymentsERC20
    function withdraw() external {
        _withdraw();
    }

    // PRIVATE FUNCTIONS
    /**
     * @dev (private) Checks payment input parameters,
     *  transfers the funds required from the external
     *  ERC20 contract, reusing buyer's local balance (if any),
     *  and stores the payment data in contract's storage.
     *  Moves the payment to AssetTransferring state
     * @param inp The PaymentInput struct
     * @param operator The address of the operator of this payment.
     */
    function _processInputPayment(
        PaymentInput calldata inp,
        address operator
    ) private {
        checkPaymentInputs(inp);
        require(
            (operator != inp.buyer) && (operator != inp.seller),
            "operator must be an observer"
        );
        _payments[inp.paymentId] = Payment(
            States.AssetTransferring,
            inp.buyer,
            inp.seller,
            operator,
            universeFeesCollector(inp.universeId),
            block.timestamp + _paymentWindow,
            inp.feeBPS,
            inp.amount
        );
        (uint256 newFunds, uint256 localFunds) = splitFundingSources(
            inp.buyer,
            inp.amount
        );
        if (newFunds > 0) {
            require(
                IERC20(_erc20).transferFrom(inp.buyer, address(this), newFunds),
                "ERC20 transfer failed"
            );
        }
        _balanceOf[inp.buyer] -= localFunds;
        emit Payin(inp.paymentId, inp.buyer, inp.seller);
    }

    /**
     * @dev (private) Moves the payment funds to the buyer's local balance
     *  The buyer still needs to withdraw afterwards.
     *  Moves the payment to REFUNDED state
     * @param paymentId The unique ID that identifies the payment.
     */
    function _refund(bytes32 paymentId) private {
        require(
            acceptsRefunds(paymentId),
            "payment does not accept refunds at this stage"
        );
        _refundToLocalBalance(paymentId);
    }

    /**
     * @dev (private) Uses the operator signed msg regarding asset transfer success to update
     *  the balances of seller (on success) or buyer (on failure).
     *  They still need to withdraw afterwards.
     *  Moves the payment to either PAID (on success) or REFUNDED (on failure) state
     * @param result The asset transfer result struct signed by the operator.
     * @param operatorSignature The operator signature of result
     */
    function _finalize(
        AssetTransferResult calldata result,
        bytes calldata operatorSignature
    ) private {
        Payment memory p = _payments[result.paymentId];
        require(
            p.state == States.AssetTransferring,
            "payment not initially in asset transferring state"
        );
        require(
            verifyAssetTransferResult(result, operatorSignature, p.operator),
            "only the operator can sign an assetTransferResult"
        );
        if (result.wasSuccessful) {
            _finalizeSuccess(result.paymentId, p);
        } else {
            _finalizeFailed(result.paymentId);
        }
    }

    /**
     * @dev (private) Updates the balance of the seller on successful asset transfer
     *  Moves the payment to PAID
     * @param paymentId The unique ID that identifies the payment.
     * @param p The payment struct corresponding to paymentId
     */
    function _finalizeSuccess(bytes32 paymentId, Payment memory p) private {
        _payments[paymentId].state = States.Paid;
        uint256 feeAmount = computeFeeAmount(p.amount, uint256(p.feeBPS));
        _balanceOf[p.seller] += (p.amount - feeAmount);
        _balanceOf[p.feesCollector] += feeAmount;
        emit Paid(paymentId);
    }

    /**
     * @dev (private) Updates the balance of the buyer on failed asset transfer
     *  Moves the payment to REFUNDED
     * @param paymentId The unique ID that identifies the payment.
     */
    function _finalizeFailed(bytes32 paymentId) private {
        _refundToLocalBalance(paymentId);
    }

    /**
     * @dev (private) Executes refund, moves to REFUNDED state
     * @param paymentId The unique ID that identifies the payment.
     */
    function _refundToLocalBalance(bytes32 paymentId) private {
        _payments[paymentId].state = States.Refunded;
        Payment memory p = _payments[paymentId];
        _balanceOf[p.buyer] += p.amount;
        emit BuyerRefunded(paymentId, p.buyer);
    }

    /**
     * @dev (private) Transfers ERC20 available in this
     *  contract's balanceOf[msg.sender] to msg.sender
     *  Follows standard Checks-Effects-Interactions pattern
     *  to protect against re-entrancy attacks.
     */
    function _withdraw() private {
        uint256 amount = _balanceOf[msg.sender];
        require(amount > 0, "cannot withdraw: balance is zero");
        _balanceOf[msg.sender] = 0;
        IERC20(_erc20).transfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    // VIEW FUNCTIONS

    /// @inheritdoc IPaymentsERC20
    function isSellerRegistrationRequired() external view returns (bool) {
        return _isSellerRegistrationRequired;
    }

    /// @inheritdoc IPaymentsERC20
    function isRegisteredSeller(address addr) external view returns (bool) {
        return _isRegisteredSeller[addr];
    }

    /// @inheritdoc IPaymentsERC20
    function erc20() external view returns (address) {
        return _erc20;
    }

    /// @inheritdoc IPaymentsERC20
    function balanceOf(address addr) external view returns (uint256) {
        return _balanceOf[addr];
    }

    /// @inheritdoc IPaymentsERC20
    function erc20BalanceOf(address addr) public view returns (uint256) {
        return IERC20(_erc20).balanceOf(addr);
    }

    /// @inheritdoc IPaymentsERC20
    function allowance(address buyer) public view returns (uint256) {
        return IERC20(_erc20).allowance(buyer, address(this));
    }

    /// @inheritdoc IPaymentsERC20
    function paymentInfo(bytes32 paymentId)
        external
        view
        returns (Payment memory)
    {
        return _payments[paymentId];
    }

    /// @inheritdoc IPaymentsERC20
    function paymentState(bytes32 paymentId) public view returns (States) {
        return _payments[paymentId].state;
    }

    /// @inheritdoc IPaymentsERC20
    function acceptsRefunds(bytes32 paymentId) public view returns (bool) {
        return
            (paymentState(paymentId) == States.AssetTransferring) &&
            (block.timestamp > _payments[paymentId].expirationTime);
    }

    /// @inheritdoc IPaymentsERC20
    function paymentWindow() external view returns (uint256) {
        return _paymentWindow;
    }

    /// @inheritdoc IPaymentsERC20
    function acceptedCurrency() external view returns (string memory) {
        return _acceptedCurrency;
    }

    /// @inheritdoc IPaymentsERC20
    function enoughFundsAvailable(address buyer, uint256 amount)
        public
        view
        returns (bool)
    {
        return maxFundsAvailable(buyer) >= amount;
    }

    /// @inheritdoc IPaymentsERC20
    function maxFundsAvailable(address buyer) public view returns (uint256) {
        uint256 approved = allowance(buyer);
        uint256 erc20Balance = erc20BalanceOf(buyer);
        uint256 externalAvailable = (approved < erc20Balance)
            ? approved
            : erc20Balance;
        return _balanceOf[buyer] + externalAvailable;
    }

    /// @inheritdoc IPaymentsERC20
    function splitFundingSources(address buyer, uint256 amount)
        public
        view
        returns (uint256 externalFunds, uint256 localFunds)
    {
        uint256 localBalance = _balanceOf[buyer];
        localFunds = (amount > localBalance) ? localBalance : amount;
        externalFunds = (amount > localBalance) ? amount - localBalance : 0;
    }

    /// @inheritdoc IPaymentsERC20
    function checkPaymentInputs(PaymentInput calldata inp) public view {
        require(inp.feeBPS <= 10000, "fee cannot be larger than 100 percent");
        require(
            paymentState(inp.paymentId) == States.NotStarted,
            "payment in incorrect curent state"
        );
        require(block.timestamp <= inp.deadline, "payment deadline expired");
        if (_isSellerRegistrationRequired)
            require(_isRegisteredSeller[inp.seller], "seller not registered");
        require(
            enoughFundsAvailable(inp.buyer, inp.amount),
            "not enough funds available for this buyer"
        );
    }

    // PURE FUNCTIONS

    /// @inheritdoc IPaymentsERC20
    function computeFeeAmount(uint256 amount, uint256 feeBPS)
        public
        pure
        returns (uint256)
    {
        uint256 feeAmount = (amount * feeBPS) / 10000;
        return (feeAmount <= amount) ? feeAmount : amount;
    }
}
