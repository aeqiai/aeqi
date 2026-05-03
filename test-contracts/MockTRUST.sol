// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock TRUST contract emitting TRUST_ModuleAdded with the same signature
/// as the real aeqi-core TRUST (sourced from
/// /home/claudedev/projects/aeqi-graph/abis/TRUST.json).
/// Used to verify the indexer's multi-address dispatch — TRUST events come
/// from the per-trust contract address, not Factory.
contract MockTRUST {
    event TRUST_ModuleAdded(
        bytes32 indexed moduleId,
        address indexed moduleAddress,
        uint256 moduleAcl
    );

    function emitModuleAdded(
        bytes32 moduleId,
        address moduleAddress,
        uint256 moduleAcl
    ) external {
        emit TRUST_ModuleAdded(moduleId, moduleAddress, moduleAcl);
    }
}
