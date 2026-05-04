// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Funding module emitting the same event signatures as the real
/// aeqi-core Funding.module (sourced from
/// /home/claudedev/projects/aeqi-graph/abis/Funding.module.json).
contract MockFunding {
    event Funding_FundingCreated(bytes32 indexed fundingId);
    event Funding_FundingActivated(bytes32 indexed fundingId);
    event Funding_FinalizedFunding(bytes32 indexed fundingId);
    event Funding_FundingRemoved(bytes32 indexed fundingId);
    event Funding_ExitExecuted(bytes32 indexed exitId);

    function emitFundingCreated(bytes32 fundingId) external {
        emit Funding_FundingCreated(fundingId);
    }

    function emitFundingActivated(bytes32 fundingId) external {
        emit Funding_FundingActivated(fundingId);
    }

    function emitFinalizedFunding(bytes32 fundingId) external {
        emit Funding_FinalizedFunding(fundingId);
    }

    function emitFundingRemoved(bytes32 fundingId) external {
        emit Funding_FundingRemoved(fundingId);
    }

    function emitExitExecuted(bytes32 exitId) external {
        emit Funding_ExitExecuted(exitId);
    }

    /// Realistic round flow: created, activated, exit executed, finalized.
    /// 4 events in one tx.
    function emitRoundLifecycle(bytes32 fundingId, bytes32 exitId) external {
        emit Funding_FundingCreated(fundingId);
        emit Funding_FundingActivated(fundingId);
        emit Funding_ExitExecuted(exitId);
        emit Funding_FinalizedFunding(fundingId);
    }
}
