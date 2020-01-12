pragma solidity >=0.5.0 <0.7.0;
pragma experimental ABIEncoderV2;

import { Constants } from "./lib/Constants.sol";
import { Types } from "./lib/Types.sol";
import "./lib/ABDKMathQuad.sol";
import "./tokens/ERC20.sol";
import "./tokens/UniversalERC20.sol";

contract LiquidityPool is
  ERC20
{
  using UniversalERC20 for IERC20;
  using ABDKMathQuad for uint256;
  using ABDKMathQuad for bytes16;
  using ABDKMathQuad for int256;

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
    addTokenLiquidity(amount);
  }

  function addTokenLiquidity(uint amount)
    internal
    returns (bool)
  {
    uint tokenSupply = totalSupply();
    IERC20(strikeAsset).universalTransferFrom(msg.sender, address(this), amount);
    if (tokenSupply == 0) {
      _mint(msg.sender, amount);
      emit LiquidityAdded(amount);
      return true;
    }
    uint tokenBalance = IERC20(strikeAsset).universalBalanceOf(address(this));
    bytes16 totalAssets =  (tokenBalance + allocated).fromUInt();
    bytes16 percentage = amount.fromUInt().div(totalAssets);
    bytes16 newTokens = percentage.mul(totalAssets);
    _mint(msg.sender, newTokens.toUInt());
    emit LiquidityAdded(amount);
    return true;
  }

  function quotePrice(Types.OptionSeries memory optionSeries)
    public
    view
    returns (uint)
  {
    uint iv = impliedVolatility[optionSeries.underlying];
    require(iv > 0);
    return uint(1);
  }
}
