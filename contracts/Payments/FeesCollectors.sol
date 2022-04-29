// SPDX-License-Identifier: MIT
pragma solidity =0.8.12;

import "./Operators.sol";

/**
 * @title Management of Fees Collectors.
 * @author Freeverse.io, www.freeverse.io
 * @dev FeesCollectors are just the addresses to which fees
 * are paid when payments are successfully completed.
 *
 * The constructor sets a defaultFeesCollector = deployer.
 * The owner of the contract can change the defaultFeesCollector.
 *
 * The owner of the contract can assign explicit feesCollectors to each universe.
 * If a universe does not have an explicitly assigned feesCollector,
 * the default feesCollector is used.
 */

contract FeesCollectors is Operators {
    event DefaultFeesCollector(address feesCollector);
    event UniverseFeesCollector(uint256 universeId, address feesCollector);

    address private _defaultFeesCollector;
    mapping(uint256 => address) private _universeFeesCollectors;

    constructor() {
        _defaultFeesCollector = msg.sender;
        emit DefaultFeesCollector(msg.sender);
    }

    function setDefaultFeesCollector(address feesCollector) external onlyOwner {
        _defaultFeesCollector = feesCollector;
        emit DefaultFeesCollector(feesCollector);
    }

    function setUniverseFeesCollector(uint256 universeId, address feesCollector)
        external
        onlyOwner
    {
        _universeFeesCollectors[universeId] = feesCollector;
        emit UniverseFeesCollector(universeId, feesCollector);
    }

    function removeUniverseFeesCollector(uint256 universeId)
        external
        onlyOwner
    {
        delete _universeFeesCollectors[universeId];
        emit UniverseFeesCollector(universeId, _defaultFeesCollector);
    }

    function defaultFeesCollector() external view returns (address) {
        return _defaultFeesCollector;
    }

    function universeFeesCollector(uint256 universeId)
        public
        view
        returns (address)
    {
        address storedFeesCollector = _universeFeesCollectors[universeId];
        return
            storedFeesCollector == address(0)
                ? _defaultFeesCollector
                : storedFeesCollector;
    }
}
