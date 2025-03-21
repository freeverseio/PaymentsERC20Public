// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/utils/cryptography/draft-EIP712.sol";
import "openzeppelin-solidity/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Verification of MetaTXs for Payments using EIP712.
 * @author Freeverse.io, www.freeverse.io
 * @dev This contract defines two structures:
 *  PaymentInput: to start a payment process
 *  AssetTransferResult: to let the operator confirm success/failure of an asset transfer
 *  It exposes the corresponding verify functions, using the EIP712 code by OpenZeppelin
 */

import "./IEIP712Verifier.sol";

contract EIP712Verifier is IEIP712Verifier, EIP712 {
    using ECDSA for bytes32;
    bytes32 private constant _TYPEHASH_PAYMENT =
        keccak256(
            "PaymentInput(bytes32 paymentId,uint256 amount,uint16 feeBPS,uint256 universeId,uint256 deadline,address buyer,address seller)"
        );

    bytes32 private constant _TYPEHASH_ASSETTRANSFER =
        keccak256("AssetTransferResult(bytes32 paymentId,bool wasSuccessful)");

    constructor() EIP712("LivingAssets ERC20 Payments", "1") {}

    /// @inheritdoc IEIP712Verifier
    function verifyPayment(
        PaymentInput calldata inp,
        bytes calldata signature,
        address signer
    ) public view returns (bool) {
        address recoveredSigner = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _TYPEHASH_PAYMENT,
                    inp.paymentId,
                    inp.amount,
                    inp.feeBPS,
                    inp.universeId,
                    inp.deadline,
                    inp.buyer,
                    inp.seller
                )
            )
        ).recover(signature);
        return signer == recoveredSigner;
    }

    /// @inheritdoc IEIP712Verifier
    function verifyAssetTransferResult(
        AssetTransferResult calldata inp,
        bytes calldata signature,
        address signer
    ) public view returns (bool) {
        address recoveredSigner = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _TYPEHASH_ASSETTRANSFER,
                    inp.paymentId,
                    inp.wasSuccessful
                )
            )
        ).recover(signature);
        return signer == recoveredSigner;
    }
}
