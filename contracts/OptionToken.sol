pragma solidity ^0.5;

import "./VariableSupplyToken.sol";


contract OptionToken is VariableSupplyToken {
    constructor(bytes32 _issuanceHash) public {
        creator = msg.sender;
        issuanceHash = _issuanceHash;
    }
}
