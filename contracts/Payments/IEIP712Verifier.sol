// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/utils/cryptography/draft-EIP712.sol";
import "openzeppelin-solidity/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Interface to Verification of MetaTXs for Payments using EIP712.
 * @author Freeverse.io, www.freeverse.io
 * @dev This contract just defines the structure of a Payment Input
 *  and exposes a verify function, using the EIP712 code by OpenZeppelin
 */

interface IEIP712Verifier {
    struct PaymentInput {
        bytes32 paymentId;
        uint256 amount;
        uint16 feeBPS;
        uint256 universeId;
        uint256 deadline;
        address buyer;
        address seller;
    }

    struct AssetTransferResult {
        bytes32 paymentId;
        bool wasSuccessful;
    }

    /**
     * @notice Verifies that the provided PaymentInput struct has been signed
     *  by the provided signer.
     * @param inp The provided PaymentInput struct
     * @param signature The provided signature of the input struct
     * @param signer The signer's address that we want to verify
     * @return Returns true if the signature corresponds to the
     *  provided signer having signed the input struct
     */
    function verifyPayment(
        PaymentInput calldata inp,
        bytes calldata signature,
        address signer
    ) external view returns (bool);

    /**
     * @notice Verifies that the provided AssetTransferResult struct
     *  has been signed by the provided signer.
     * @param result The provided AssetTransferResult struct
     * @param signature The provided signature of the input struct
     * @param signer The signer's address that we want to verify
     * @return Returns true if the signature corresponds to the signer
     *  having signed the input struct
     */
    function verifyAssetTransferResult(
        AssetTransferResult calldata result,
        bytes calldata signature,
        address signer
    ) external view returns (bool);
}
