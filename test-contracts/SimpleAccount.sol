// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SimpleAccount — minimal ERC-4337 v0.7 smart account for integration tests.
///
/// Validates UserOps signed by its `owner` address using eth_sign-style ECDSA.
/// Encodes callData as `abi.encodeCall(execute, (target, value, callData))`.
/// Deploy directly — no factory or beacon.
///
/// NOT for production. Missing: nonce isolation, cross-chain replay protection.
contract SimpleAccount {
    // ── State ────────────────────────────────────────────────────────────────

    address public owner;
    address public entryPoint;

    uint256 private constant SIG_VALIDATION_SUCCESS = 0;
    uint256 private constant SIG_VALIDATION_FAILED = 1;

    // ── Events ───────────────────────────────────────────────────────────────

    event SimpleAccount_Executed(address indexed target, uint256 value);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address owner_, address entryPoint_) {
        owner = owner_;
        entryPoint = entryPoint_;
    }

    receive() external payable {}

    // ── IAccount interface ───────────────────────────────────────────────────

    /// ERC-4337 v0.7 — validateUserOp.
    ///
    /// Signature: eth_sign of `userOpHash` — i.e. personal_sign / EIP-191 prefix.
    ///
    /// @param userOp     The packed UserOperation.
    /// @param userOpHash Hash produced by the EntryPoint (commits to userOp + EP + chainId).
    /// @param missingAccountFunds  Wei the account must send the EntryPoint as prefund.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        require(msg.sender == entryPoint, "SA: not EP");

        if (missingAccountFunds > 0) {
            (bool ok,) = payable(msg.sender).call{value: missingAccountFunds}("");
            require(ok, "SA: prefund fail");
        }

        // Recover from eth_sign prefix.
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        address recovered = _ecrecover(prefixed, userOp.signature);
        return recovered == owner ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
    }

    // ── Execution ────────────────────────────────────────────────────────────

    /// Entry-point callable execute: the UserOp callData is
    /// `abi.encodeCall(SimpleAccount.execute, (target, value, data))`.
    function execute(address target, uint256 value, bytes calldata data) external {
        require(msg.sender == entryPoint || msg.sender == owner, "SA: forbidden");
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            if (ret.length > 0) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
            revert("SA: call failed");
        }
        emit SimpleAccount_Executed(target, value);
    }

    // ── ECDSA recovery ───────────────────────────────────────────────────────

    function _ecrecover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        return ecrecover(h, v, r, s);
    }
}

// ── PackedUserOperation — ERC-4337 v0.7 ─────────────────────────────────────

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}
