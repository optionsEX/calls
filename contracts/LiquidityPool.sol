pragma solidity >=0.5.0 <0.7.0;

import { Constants } from "./lib/Constants.sol";
import "./lib/ABDKMath64x64.sol";
import "./ownership/Ownable.sol";
import "./interfaces/IERC20.sol";
import "./tokens/ERC20.sol";
import "./tokens/SafeERC20.sol";

contract LiquidityPool is
  ERC20
{
  using SafeERC20 for IERC20;
  using ABDKMath64x64 for uint256;
  using ABDKMath64x64 for int128;

  address strikeAsset;
  uint riskFreeRate;

  uint allocated;
  uint totalLiquidity;
  // Implied volatility for an underlying
  mapping(address => uint) public impliedVolatility;

  event LiquidityAdded(uint amount);

  constructor(address _strikeAsset, address underlying, uint rfr, uint iv) public {
    strikeAsset = _strikeAsset;
    riskFreeRate = rfr;
    address underlyingAddress = address(0) == underlying ? Constants.ethAddress() : underlying;
    impliedVolatility[underlyingAddress] = iv;
  }

  function addLiquidity(uint amount)
    public
    payable
    returns (bool)
  {
    if (strikeAsset == Constants.ethAddress()) {
      addEthLiquidity(amount);
    } else {
      addTokenLiquidity(amount);
    }

  }

  function addTokenLiquidity(uint amount)
    internal
    returns (bool)
  {
    require(msg.value == 0, "There should be no ETH sent");
    uint tokenSupply = totalSupply();
    IERC20(strikeAsset).safeTransferFrom(msg.sender, address(this), amount);
    if (tokenSupply == 0) {
      _mint(msg.sender, amount);
      emit LiquidityAdded(amount);
      return true;
    }
    uint tokenBalance = IERC20(strikeAsset).balanceOf(address(this));
    uint totalAssets =  tokenBalance + allocated;
    int128 percentage = amount.divu(totalAssets);
    uint newTokens = percentage.mulu(totalAssets);
    _mint(msg.sender, newTokens);
    emit LiquidityAdded(amount);
    return true;
  }

  function addEthLiquidity(uint amount)
    internal
    returns (bool)
  {
    require(amount == msg.value);
    uint tokenSupply = totalSupply();
    if (tokenSupply == 0) {
      _mint(msg.sender, msg.value);
      emit LiquidityAdded(amount);
      return true;
    }
    uint totalAssets = address(this).balance + allocated + msg.value;
    int128 percentage = msg.value.divu(totalAssets);
    uint newTokens = percentage.mulu(totalAssets);
    _mint(msg.sender, newTokens);
    emit LiquidityAdded(amount);
    return true;
  }

}
