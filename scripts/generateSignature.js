require('dotenv').config();
const { prepareDataToSignPayment } = require('../helpers/signer');
// eslint-disable-next-line import/order
const ethSigUtil = require('eth-sig-util');

const fromHexString = (hexString) => new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

const now = Math.floor(Date.now() / 1000);

const seller = '0xaaAb4395d7F6323F83A8D532604083e46b4992Eb';
const buyer = '0x356a2Fb02Cc64Cb370fc54d52041b9485555E63d';
const operatorPvk = process.env.DEPLOYER_MNEMONIC;
const chainId = 80001;
const contractAddress = '0xC1f443139461dC2Cc30107b0578ae1B833192a48';
const deadline = `${now + 3600}`;

const paymentData = {
  paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
  amount: '123',
  feeBPS: '1000',
  universeId: '1',
  deadline,
  buyer,
  seller,
};

// Buyer signs purchase
const operatorSignature = ethSigUtil.signTypedMessage(
  fromHexString(operatorPvk),
  prepareDataToSignPayment({
    msg: paymentData,
    chainId,
    contractAddress,
  }),
);

console.log(operatorSignature);
console.log('deadline: ', deadline);
// 0x5802d1377c57b59230de723a411d75b3df30839a04d40acb88e8c9c568673dfa1ff8ee1d7ef27b357b5139644efdfa589aa8406e04fb08deadea1d8ed22f1fd71c
// ["0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03", "123", 1000, "1", "1645466201", "0x356a2Fb02Cc64Cb370fc54d52041b9485555E63d", "0xaaAb4395d7F6323F83A8D532604083e46b4992Eb"]
// ["0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03",123,1000,1,1645466201,"356a2Fb02Cc64Cb370fc54d52041b9485555E63d","aaAb4395d7F6323F83A8D532604083e46b4992Eb"]