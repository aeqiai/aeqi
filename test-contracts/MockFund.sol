// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Fund module emitting the same event signatures as the real
/// aeqi-core Fund.module (sourced from
/// /home/claudedev/projects/aeqi-graph/abis/Fund.module.json).
contract MockFund {
    event Fund_NavProcessed(
        uint64 indexed checkpointId,
        uint256 netNAV,
        uint256 tokenQuote,
        uint256 mgmtFeesCharged,
        uint256 carryCharged
    );
    event Fund_FlowRequested(
        bytes32 indexed requestId,
        bytes32 indexed roleId,
        uint8 flowType,
        uint256 amountIn
    );
    event Fund_FlowClaimed(bytes32 indexed requestId, uint256 amountOut);
    event Fund_FlowCancelled(bytes32 indexed requestId);
    event Fund_PositionOpened(
        bytes32 indexed positionId,
        bytes32 indexed positionManagerId
    );
    event Fund_PositionClosed(
        bytes32 indexed positionId,
        uint256 quoteAssetReceived
    );
    event Fund_PositionInteracted(
        bytes32 indexed positionId,
        bytes32 indexed roleId,
        uint8 action
    );

    function emitNav(
        uint64 checkpointId,
        uint256 netNAV,
        uint256 tokenQuote,
        uint256 mgmtFees,
        uint256 carry
    ) external {
        emit Fund_NavProcessed(checkpointId, netNAV, tokenQuote, mgmtFees, carry);
    }

    function emitFlowRequested(
        bytes32 requestId,
        bytes32 roleId,
        uint8 flowType,
        uint256 amountIn
    ) external {
        emit Fund_FlowRequested(requestId, roleId, flowType, amountIn);
    }

    function emitFlowClaimed(bytes32 requestId, uint256 amountOut) external {
        emit Fund_FlowClaimed(requestId, amountOut);
    }

    function emitFlowCancelled(bytes32 requestId) external {
        emit Fund_FlowCancelled(requestId);
    }

    function emitPositionOpened(bytes32 positionId, bytes32 positionManagerId) external {
        emit Fund_PositionOpened(positionId, positionManagerId);
    }

    function emitPositionClosed(bytes32 positionId, uint256 quoteAssetReceived) external {
        emit Fund_PositionClosed(positionId, quoteAssetReceived);
    }

    function emitPositionInteracted(
        bytes32 positionId,
        bytes32 roleId,
        uint8 action
    ) external {
        emit Fund_PositionInteracted(positionId, roleId, action);
    }

    /// Realistic fund cycle: NAV processed, LP requests deposit, deposit
    /// settles, GP opens a position, GP rebalances, GP closes the position.
    /// 6 events in one tx.
    function emitFundCycle(
        uint64 checkpointId,
        bytes32 requestId,
        bytes32 roleId,
        bytes32 positionId,
        bytes32 positionManagerId
    ) external {
        emit Fund_NavProcessed(checkpointId, 1000000, 100, 100, 200);
        emit Fund_FlowRequested(requestId, roleId, 0, 50000);
        emit Fund_FlowClaimed(requestId, 49500);
        emit Fund_PositionOpened(positionId, positionManagerId);
        emit Fund_PositionInteracted(positionId, roleId, 1);
        emit Fund_PositionClosed(positionId, 52000);
    }
}
