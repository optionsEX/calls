pragma solidity >=0.5.0 <0.7.0;

import "./OptionRegistry.sol";
import "./Exchange.sol";
import "./LiquidityPools.sol";

contract Protocol is
  OptionRegistry,
  Exchange,
  LiquidityPools
{

  constructor(address _token, address _usd) public {
    protocolToken = IERC20(_token);
    usdERC20 = IERC20(_usd);
  }

  function() external payable {
    revert();
  }

}
