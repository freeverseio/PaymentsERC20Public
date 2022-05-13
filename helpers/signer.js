const ERC712DomainTypes = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const PaymentInput = [
  { name: 'paymentId', type: 'bytes32' },
  { name: 'amount', type: 'uint256' },
  { name: 'feeBPS', type: 'uint256' },
  { name: 'universeId', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'buyer', type: 'address' },
  { name: 'seller', type: 'address' },
];

const AssetTransferResult = [
  { name: 'paymentId', type: 'bytes32' },
  { name: 'wasSuccessful', type: 'bool' },
];

function getERC712DomainInstance(chainId, contractAddress) {
  return {
    name: 'LivingAssets ERC20 Payments',
    version: '1',
    chainId,
    verifyingContract: contractAddress,
  };
}

function prepareDataToSignPayment({ msg, chainId, contractAddress }) {
  return {
    data: {
      types: {
        EIP712Domain: ERC712DomainTypes,
        PaymentInput,
      },
      domain: getERC712DomainInstance(chainId, contractAddress),
      primaryType: 'PaymentInput',
      message: msg,
    },
  };
}

function prepareDataToSignAssetTransfer({ msg, chainId, contractAddress }) {
  return {
    data: {
      types: {
        EIP712Domain: ERC712DomainTypes,
        AssetTransferResult,
      },
      domain: getERC712DomainInstance(chainId, contractAddress),
      primaryType: 'AssetTransferResult',
      message: msg,
    },
  };
}

module.exports = {
  prepareDataToSignPayment,
  prepareDataToSignAssetTransfer,
};
