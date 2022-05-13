// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "openzeppelin-solidity/contracts/access/Ownable.sol";

/**
 * @title Management of Operators.
 * @author Freeverse.io, www.freeverse.io
 * @dev The Operator role is to execute the actions required when
 * payments arrive to this contract, and then either
 * confirm the success of those actions, or confirm the failure.
 *
 * The constructor sets a defaultOperator = deployer.
 * The owner of the contract can change the defaultOperator.
 *
 * The owner of the contract can assign explicit operators to each universe.
 * If a universe does not have an explicitly assigned operator,
 * the default operator is used.
 */

contract Operators is Ownable {
    event DefaultOperator(address indexed operator);
    event UniverseOperator(uint256 indexed universeId, address indexed operator);

    address private _defaultOperator;
    mapping(uint256 => address) private _universeOperators;

    constructor() {
        _defaultOperator = msg.sender;
        emit DefaultOperator(msg.sender);
    }

    function setDefaultOperator(address operator) external onlyOwner {
        _defaultOperator = operator;
        emit DefaultOperator(operator);
    }

    function setUniverseOperator(uint256 universeId, address operator)
        external
        onlyOwner
    {
        _universeOperators[universeId] = operator;
        emit UniverseOperator(universeId, operator);
    }

    function removeUniverseOperator(uint256 universeId) external onlyOwner {
        delete _universeOperators[universeId];
        emit UniverseOperator(universeId, _defaultOperator);
    }

    function defaultOperator() external view returns (address) {
        return _defaultOperator;
    }

    function universeOperator(uint256 universeId)
        public
        view
        returns (address)
    {
        address storedOperator = _universeOperators[universeId];
        return storedOperator == address(0) ? _defaultOperator : storedOperator;
    }
}
