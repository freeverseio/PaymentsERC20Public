// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

/**
 * @title Interface to Verification of MetaTXs for Payments using EIP712.
 * @author Freeverse.io, www.freeverse.io
 * @dev This contract defines two structures (PaymentInput, AssetTransferResult)
 *  and their two corresponding verify functions, which use the EIP712 code by OpenZeppelin
 */

interface IEIP712Verifier {

    /**
    * @notice The main struct that characterizes a payment
    * @dev used as input to the pay & relayedPay methods
    * @dev it needs to be signed following EIP712
    */
    struct PaymentInput {
        // the unique Id that identifies a payment,
        // obtained from a sufficiently large source of entropy.
        bytes32 paymentId;

        // the price of the asset, an integer expressed in the
        // lowest unit of the ERC20 token.
        uint256 amount;

        // the fee that will be charged by the feeOperator,
        // expressed as percentage Basis Points (bps), applied to amount.
        uint256 feeBPS;

        // the id of the universe that the asset belongs to.
        uint256 universeId;

        // the deadline for the payment to arrive to this
        // contract, otherwise it will be rejected.
        uint256 deadline;

        // the buyer, providing the required funds, who shall receive
        // the asset on a successful payment.
        address buyer;

        // the seller of the asset, who shall receive the funds
        // (subtracting fees) on a successful payment.
        address seller;
    }

    /**
    * @notice The struct that specifies the success or failure of an asset transfer
    * @dev It needs to be signed by the operator following EIP712
    * @dev Must arrive when the asset is in ASSET_TRANSFERING state, to then move to PAID or REFUNDED
    */
    struct AssetTransferResult {
        // the unique Id that identifies a payment previously initiated in this contract.
        bytes32 paymentId;

        // a bool set to true if the asset was successfully transferred, false otherwise
        bool wasSuccessful;
    }

    /**
     * @notice Verifies that the provided PaymentInput struct has been signed
     *  by the provided signer.
     * @param payInput The provided PaymentInput struct
     * @param signature The provided signature of the input struct
     * @param signer The signer's address that we want to verify
     * @return Returns true if the signature corresponds to the
     *  provided signer having signed the input struct
     */
    function verifyPayment(
        PaymentInput calldata payInput,
        bytes calldata signature,
        address signer
    ) external view returns (bool);

    /**
     * @notice Verifies that the provided AssetTransferResult struct
     *  has been signed by the provided signer.
     * @param transferResult The provided AssetTransferResult struct
     * @param signature The provided signature of the input struct
     * @param signer The signer's address that we want to verify
     * @return Returns true if the signature corresponds to the signer
     *  having signed the input struct
     */
    function verifyAssetTransferResult(
        AssetTransferResult calldata transferResult,
        bytes calldata signature,
        address signer
    ) external view returns (bool);
}
