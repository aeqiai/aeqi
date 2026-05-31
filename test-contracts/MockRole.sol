// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Role module emitting the same event signatures as the real
/// aeqi-core Role.module.
/// Used to verify the indexer's per-module dispatch — Role events come
/// from the module address, which is auto-watched after COMPANY_ModuleAdded.
contract MockRole {
    event Role_RoleCreated(bytes32 indexed roleId, address indexed creator);
    event Role_RoleAssigned(bytes32 indexed roleId, address indexed occupant);
    event Role_RoleResigned(bytes32 indexed roleId, address indexed occupant);
    event Role_RoleRemoved(
        bytes32 indexed authorizedRoleId,
        bytes32 indexed roleId,
        address indexed account
    );
    event Role_RoleTransferred(
        bytes32 indexed roleId,
        address indexed oldHolder,
        address indexed newHolder
    );

    function emitRoleCreated(bytes32 roleId, address creator) external {
        emit Role_RoleCreated(roleId, creator);
    }

    function emitRoleAssigned(bytes32 roleId, address occupant) external {
        emit Role_RoleAssigned(roleId, occupant);
    }

    function emitRoleResigned(bytes32 roleId, address occupant) external {
        emit Role_RoleResigned(roleId, occupant);
    }

    function emitRoleRemoved(
        bytes32 authorizedRoleId,
        bytes32 roleId,
        address account
    ) external {
        emit Role_RoleRemoved(authorizedRoleId, roleId, account);
    }

    function emitRoleTransferred(
        bytes32 roleId,
        address oldHolder,
        address newHolder
    ) external {
        emit Role_RoleTransferred(roleId, oldHolder, newHolder);
    }

    /// Founder lifecycle: founder creates a "Founder" role, gets assigned to it,
    /// later transfers it to a successor. 3 events in one tx.
    function emitFounderLifecycle(
        bytes32 roleId,
        address founder,
        address successor
    ) external {
        emit Role_RoleCreated(roleId, founder);
        emit Role_RoleAssigned(roleId, founder);
        emit Role_RoleTransferred(roleId, founder, successor);
    }
}
