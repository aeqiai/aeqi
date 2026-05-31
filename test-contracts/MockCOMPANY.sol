// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock COMPANY contract emitting the same event signatures as the real
/// aeqi-core COMPANY.
/// Used to verify the indexer's multi-address dispatch — COMPANY events come
/// from the per-company contract address, not Factory.
contract MockCOMPANY {
    event COMPANY_ModuleAdded(
        bytes32 indexed moduleId,
        address indexed moduleAddress,
        uint256 moduleAcl
    );
    event PermissionsGranted(bytes32 indexed id, uint256 flags);
    event PermissionsRevoked(bytes32 indexed id, uint256 flags);
    event PermissionsSet(bytes32 indexed id, uint256 flags);

    function emitModuleAdded(
        bytes32 moduleId,
        address moduleAddress,
        uint256 moduleAcl
    ) external {
        emit COMPANY_ModuleAdded(moduleId, moduleAddress, moduleAcl);
    }

    function emitPermissionsGranted(bytes32 id, uint256 flags) external {
        emit PermissionsGranted(id, flags);
    }

    function emitPermissionsRevoked(bytes32 id, uint256 flags) external {
        emit PermissionsRevoked(id, flags);
    }

    function emitPermissionsSet(bytes32 id, uint256 flags) external {
        emit PermissionsSet(id, flags);
    }

    /// Realistic flow for a single agent: grant some flags, revoke a subset,
    /// later overwrite the entire set. Three events in one tx.
    function emitPermissionsLifecycle(
        bytes32 id,
        uint256 grantedFlags,
        uint256 revokedFlags,
        uint256 finalFlags
    ) external {
        emit PermissionsGranted(id, grantedFlags);
        emit PermissionsRevoked(id, revokedFlags);
        emit PermissionsSet(id, finalFlags);
    }
}
