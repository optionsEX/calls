pragma solidity >=0.5.0 <0.7.0;
pragma experimental ABIEncoderV2;

import { Constants } from "./lib/Constants.sol";
import { Types } from "./lib/Types.sol";
import "./lib/ABDKMathQuad.sol";
import "./lib/BlackScholes.sol";
import "./tokens/ERC20.sol";
import "./tokens/UniversalERC20.sol";
import "./Protocol.sol";
import "./PriceFeed.sol";
import "./OptionRegistry.sol";

contract LiquidityPool is
  BlackScholes,
  ERC20
{
  using UniversalERC20 for IERC20;
  using ABDKMathQuad for uint256;
  using ABDKMathQuad for bytes16;
  using ABDKMathQuad for int256;

  address public protocol;
  address public strikeAsset;
  uint public riskFreeRate;
  uint public allocated;
  // Implied volatility for an underlying
  mapping(address => uint) public impliedVolatility;

  event LiquidityAdded(uint amount);
  event UnderlyingAdded(address underlying);
  event ImpliedVolatilityUpdated(address underlying, uint iv);

  constructor(address _protocol, address _strikeAsset, address underlying, uint rfr, uint iv) public {
    strikeAsset = _strikeAsset;
    riskFreeRate = rfr;
    address underlyingAddress = IERC20(underlying).isETH() ? Constants.ethAddress() : underlying;
    impliedVolatility[underlyingAddress] = iv;
    protocol = _protocol;
    emit UnderlyingAdded(underlyingAddress);
    emit ImpliedVolatilityUpdated(underlyingAddress, iv);
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

  function getPriceFeed() internal returns (PriceFeed) {
    address feedAddress = Protocol(protocol).priceFeed();
    return PriceFeed(feedAddress);
  }

  function getOptionRegistry() internal returns (OptionRegistry) {
    address registryAddress = Protocol(protocol).optionRegistry();
    return OptionRegistry(registryAddress);
  }

  function getUnderlyingPrice(
    Types.OptionSeries memory optionSeries
  )
    internal
    returns (uint)
  {
    PriceFeed priceFeed = getPriceFeed();
    uint underlyingPrice = priceFeed.getPriceQuote(
      optionSeries.strikeAsset,
      optionSeries.underlying,
      1 ether
    );
    return underlyingPrice;
  }

  function quotePrice(
    Types.OptionSeries memory optionSeries
  )
    public
    returns (uint)
  {
    uint iv = impliedVolatility[optionSeries.underlying];
    require(iv > 0, "Implied volatility not found");
    require(optionSeries.expiration > now, "Already expired");
    uint underlyingPrice = getUnderlyingPrice(optionSeries);
    // calculate using black-scholes
    return retBlackScholesCalc(
       underlyingPrice,
       optionSeries.strike,
       optionSeries.expiration,
       iv,
       riskFreeRate,
       optionSeries.flavor
    );
  }

  function quotePriceWithUtilization(
    Types.OptionSeries memory optionSeries,
    uint amount
  )
    public
    returns (uint)
  {
    uint optionPrice = quotePrice(optionSeries);
    bytes16 underlyingPrice = getUnderlyingPrice(optionSeries).fromUInt();
    bytes16 updatedAllocation = amount.fromUInt();
    bytes16 utilization = updatedAllocation.div(totalSupply().fromUInt());
    uint utilizationPrice = underlyingPrice.mul(utilization).toUInt();
    return utilizationPrice > optionPrice ? utilizationPrice : optionPrice;
  }

}
