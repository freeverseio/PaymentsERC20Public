// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/utils/cryptography/draft-EIP712.sol";
import "openzeppelin-solidity/contracts/utils/cryptography/ECDSA.sol";
import "./IEIP712Verifier.sol";

/**
 * @title Verification of MetaTXs for Payments using EIP712.
 * @author Freeverse.io, www.freeverse.io
 * @dev This contract implements the two verification functions for the two main
 *  structures required in the payment process, and defined in ISignableStructs:
 *  - PaymentInput: to start a payment process
 *  - AssetTransferResult: to let the operator confirm the success or failure of an asset transfer
 *  The implementation uses the code in draft-EIP712 by OpenZeppelin.
 *  Contracts that call the code provided in this contract are recommended to implement an 
 *  upgrade pattern, in case that the EIP712 spec/code changes in the future.
 */

contract EIP712Verifier is IEIP712Verifier, EIP712 {
    using ECDSA for bytes32;
    bytes32 private constant _TYPEHASH_PAYMENT =
        keccak256(
            "PaymentInput(bytes32 paymentId,uint256 amount,uint256 feeBPS,uint256 universeId,uint256 deadline,address buyer,address seller)"
        );

    bytes32 private constant _TYPEHASH_ASSETTRANSFER =
        keccak256("AssetTransferResult(bytes32 paymentId,bool wasSuccessful)");

    constructor() EIP712("LivingAssets ERC20 Payments", "1") {}

    /// @inheritdoc IEIP712Verifier
    function verifyPayment(
        PaymentInput calldata payInput,
        bytes calldata signature,
        address signer
    ) public view returns (bool) {
        address recoveredSigner = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _TYPEHASH_PAYMENT,
                    payInput.paymentId,
                    payInput.amount,
                    payInput.feeBPS,
                    payInput.universeId,
                    payInput.deadline,
                    payInput.buyer,
                    payInput.seller
                )
            )
        ).recover(signature);
        return signer == recoveredSigner;
    }

    /// @inheritdoc IEIP712Verifier
    function verifyAssetTransferResult(
        AssetTransferResult calldata transferResult,
        bytes calldata signature,
        address signer
    ) public view returns (bool) {
        address recoveredSigner = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _TYPEHASH_ASSETTRANSFER,
                    transferResult.paymentId,
                    transferResult.wasSuccessful
                )
            )
        ).recover(signature);
        return signer == recoveredSigner;
    }
}
