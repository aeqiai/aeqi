// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Factory that emits the same event signatures as the real aeqi-core
/// Factory. Used by the indexer test loop to verify end-to-end decode +
/// dispatch without deploying full aeqi-core.
contract MockFactory {
    event Factory_COMPANYCreatedEvent(
        address indexed creatorAddress,
        bytes32 indexed companyId,
        address indexed companyAddress
    );
    event Factory_COMPANYRegisteredEvent(
        address indexed creatorAddress,
        bytes32 indexed companyId,
        bytes32 indexed templateId,
        bytes ipfsCid,
        uint256 signersCount,
        uint256 valueConfigsCount
    );
    event Factory_COMPANIESignerAdded(
        bytes32 indexed companyId,
        bytes32 indexed addressKey,
        address indexed signerAddress,
        bool hasSigned
    );

    function emitCompanyCreated(
        address creator,
        bytes32 companyId,
        address companyAddress
    ) external {
        emit Factory_COMPANYCreatedEvent(creator, companyId, companyAddress);
    }

    function emitCompanyRegistered(
        address creator,
        bytes32 companyId,
        bytes32 templateId,
        bytes calldata ipfsCid,
        uint256 signersCount,
        uint256 valueConfigsCount
    ) external {
        emit Factory_COMPANYRegisteredEvent(
            creator, companyId, templateId, ipfsCid, signersCount, valueConfigsCount
        );
    }

    function emitCompanySignerAdded(
        bytes32 companyId,
        bytes32 addressKey,
        address signerAddress,
        bool hasSigned
    ) external {
        emit Factory_COMPANIESignerAdded(companyId, addressKey, signerAddress, hasSigned);
    }

    /// Realistic flow: one tx emits all three events for a single COMPANY
    /// (matches the real Factory.createAndRegisterCOMPANY shape).
    function emitFullCompanyCreation(
        address creator,
        bytes32 companyId,
        address companyAddress,
        bytes32 templateId,
        bytes calldata ipfsCid,
        bytes32 addressKey,
        address signerAddress
    ) external {
        emit Factory_COMPANYCreatedEvent(creator, companyId, companyAddress);
        emit Factory_COMPANYRegisteredEvent(
            creator, companyId, templateId, ipfsCid, 1, 0
        );
        emit Factory_COMPANIESignerAdded(companyId, addressKey, signerAddress, true);
    }
}
