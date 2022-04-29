/* eslint-disable no-undef */
const { assert } = require('chai');

require('chai')
  .use(require('chai-as-promised'))
  .should();
const Wallet = require('ethereumjs-wallet').default;
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignPayment, prepareDataToSignAssetTransfer } = require('../helpers/signer');

const EIP712Verifier = artifacts.require('EIP712Verifier');

contract('EIP712Verifier', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};

  const [deployer] = accounts;
  const wallet = Wallet.generate();
  const sender = web3.utils.toChecksumAddress(wallet.getAddressString());
  const paymentData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    amount: '23',
    feeBPS: 500,
    universeId: '1',
    deadline: '12345',
    buyer: sender,
    seller: deployer,
  };
  const assetTransferResultData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    wasSuccessful: true,
  };

  const fromHexString = (hexString) => new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

  let verifier;

  beforeEach(async () => {
    verifier = await EIP712Verifier.new().should.be.fulfilled;
  });

  it('payment signature matches expected explicit value 0 / EIP712 spec', async () => {
    // Example taken from the EIP:
    // https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md
    // https://github.com/ethereum/EIPs/blob/master/assets/eip-712/Example.js
    const expectedSig = '0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c';
    const privateKey = web3.utils.keccak256('cow'); // this private key corresponds to 0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826
    assert.equal(privateKey, '0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4');
    const spec = {
      jsonrpc: '2.0',
      method: 'eth_signTypedData',
      params: [
        '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person',
              },
              {
                name: 'contents',
                type: 'string',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: 1,
            verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            from: {
              name: 'Cow',
              wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: {
              name: 'Bob',
              wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            },
            contents: 'Hello, Bob!',
          },
        },
      ],
      id: 1,
    };
    const sig = ethSigUtil.signTypedMessage(
      fromHexString(privateKey.substr(2)),
      {
        data: {
          types: spec.params[1].types,
          domain: spec.params[1].domain,
          primaryType: spec.params[1].primaryType,
          message: spec.params[1].message,
        },
      },
    );
    assert.equal(sig, expectedSig);
  });

  it('payment signature matches expected explicit value - 1 / happy path', async () => {
    const expectedSig = '0xb1a1d34d385dfb4f0b45cc0d48298b2395628765d2c2d9312c33fc4d86f540464ab6e469d351a1110b130cc04b25b86d928391fdad8d8206b5931d5662498b1d1c';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      amount: '23',
      feeBPS: 500,
      universeId: '1',
      deadline: '12345',
      buyer: '0x5Ca59cbA5D0D0D604bF59cD0e7b3cD3c350142BE',
      seller: '0xBDcaD33BA6eF2086F2511610Fa5Bedaf062CC1Cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignPayment({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 2 / empty universeId', async () => {
    const expectedSig = '0x42f8d5808cf5e0ceac826b9bb4963acc999bbf51aa0f4df7dd5902dcb42ebef27dd7a0efa6798541759e867c0bdeaa953313f3a338f7af1def63b503143f35eb1c';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      amount: '23',
      feeBPS: 500,
      universeId: '',
      deadline: '12345',
      buyer: '0x5ca59cba5d0d0d604bf59cd0e7b3cd3c350142be',
      seller: '0xbdcad33ba6ef2086f2511610fa5bedaf062cc1cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignPayment({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 3 / empty contractAddr', async () => {
    const expectedSig = '0xb1c6c04d50a97181e8a112a7e7892458b3171cd939e149938f234576d050e4117ae25982ab18a82514f0b27d3bada01e7ca3ee8c5e8e5f19e59fd717da00cf0f1c';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      amount: '23',
      feeBPS: 500,
      universeId: '',
      deadline: '12345',
      buyer: '0x5ca59cba5d0d0d604bf59cd0e7b3cd3c350142be',
      seller: '0xbdcad33ba6ef2086f2511610fa5bedaf062cc1cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignPayment({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature is correctly verified', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignPayment({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );
    assert.equal(await verifier.verifyPayment(paymentData, signature, sender), true);
  });

  it('payment signature is rejected if incorrect', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignPayment({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const wrongPaymentData = JSON.parse(JSON.stringify(paymentData));
    wrongPaymentData.amount = '24';

    assert.equal(await verifier.verifyPayment(paymentData, signature, sender), true);
    assert.equal(await verifier.verifyPayment(wrongPaymentData, signature, sender), false);
  });

  it('payment signature is only valid for one contract address', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignPayment({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const verifier2 = await EIP712Verifier.new().should.be.fulfilled;

    assert.equal(await verifier.verifyPayment(paymentData, signature, sender), true);
    assert.equal(await verifier2.verifyPayment(paymentData, signature, sender), false);
  });

  it('assetTransferResult signature is rejected if incorrect', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignAssetTransfer({
        msg: assetTransferResultData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const wrongData = JSON.parse(JSON.stringify(assetTransferResultData));
    wrongData.wasSuccessful = false;

    assert.equal(
      await verifier.verifyAssetTransferResult(assetTransferResultData, signature, sender),
      true,
    );
    assert.equal(await verifier.verifyAssetTransferResult(wrongData, signature, sender), false);
  });

  it('assetTransferResult signature is only valid for one contract address', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignAssetTransfer({
        msg: assetTransferResultData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const verifier2 = await EIP712Verifier.new().should.be.fulfilled;

    assert.equal(
      await verifier.verifyAssetTransferResult(assetTransferResultData, signature, sender),
      true,
    );
    assert.equal(
      await verifier2.verifyAssetTransferResult(assetTransferResultData, signature, sender),
      false,
    );
  });

  it('assetTransferResult signature matches expected explicit value - 1 / happy path', async () => {
    const expectedSig = '0xb595abf6231404151a588428c4cf6a1cf712ada9818ad5acef249d33c4a7f7d825e6ac7162c4528f3a1b42ce6509efea066789abb5d78bfb24afdd49b007b5181c';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedAssetTransferData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      wasSuccessful: true,
    };
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignAssetTransfer({
        msg: hardcodedAssetTransferData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('assetTransferResult signature matches expected explicit value - 2 / empty contractAddr', async () => {
    const expectedSig = '0x57e1b4a39e1137bef1b6b5a8a2fb7dc7b733f8b49ca1f499faa99d971c91d7a50f40d5fe373ac9217b48a53f9d8b5fff9b4010b9246f73ee05c18466cb53aea61b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '';
    const hardcodedAssetTransferData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      wasSuccessful: true,
    };
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignAssetTransfer({
        msg: hardcodedAssetTransferData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });
});
