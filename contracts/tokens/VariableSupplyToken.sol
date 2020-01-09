pragma solidity ^0.5;

import "./ERC20.sol";
import "../ownership/Ownable.sol";


contract VariableSupplyToken is ERC20, Ownable {

    /* function grant(address to, uint256 amount) public onlyOwner returns (bool) { */
    /*   //require(msg.sender == creator); */
    /*     require(balances[to] + amount >= amount); */
    /*     balances[to] += amount; */
    /*     totalSupply += amount; */
    /*     return true; */
    /* } */

    /* function burn(address from, uint amount) public onlyOwner returns (bool) { */
    /*   //require(msg.sender == creator); */
    /*     require(balances[from] >= amount); */
    /*     balances[from] -= amount; */
    /*     totalSupply -= amount; */
    /*     return true; */
    /* } */
}
