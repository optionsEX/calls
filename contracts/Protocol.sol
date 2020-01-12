pragma solidity >=0.5.0 <0.7.0;


contract Protocol {

  address public optionRegistry;
  address public liquidityPools;

  constructor(address _optionRegistry, address _liquidityPools) public {
    optionRegistry = _optionRegistry;
    liquidityPools = _liquidityPools;
  }

  function() external payable {
    revert();
  }

}
