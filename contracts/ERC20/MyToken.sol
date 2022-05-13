// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

/**
 * @title Toy example of an ERC20 implentation, purely for testing purposes.
 * @dev It inherits the OpenZeppelin ERC20 implementation.
 *  On deploy, the constructor mints 100 tokens to msg.sender
 *  To be used within the PaymentsERC20 test framework.  
 */
contract MyToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        // Mint 100 tokens to msg.sender
        // 1 token = 1 * (10 ** decimals)
        _mint(msg.sender, 100 * 10**uint(decimals()));
    }
}
