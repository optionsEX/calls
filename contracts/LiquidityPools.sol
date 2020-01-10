pragma solidity >=0.5.0 <0.7.0;

import "./LiquidityPool.sol";

contract LiquidityPools {
  // maps a strikeAsset to a liquidity pool
  mapping(address => address) public strikeAssets;

  event LiquidityPoolCreated(address lp, address strikeAsset);

  function createLiquidityPool(address _strikeAsset, address underlying, uint rfr, uint iv) public {
    address lp = strikeAssets[_strikeAsset];
    require(lp == address(0), "Liquidity Pool already exists");
    lp = address(new LiquidityPool(_strikeAsset, underlying, rfr, iv));
    strikeAssets[_strikeAsset] = lp;
    emit LiquidityPoolCreated(lp, _strikeAsset);
  }

  function supplyLiquidity(address _strikeAsset, uint amount) public {
    address lp = strikeAssets[_strikeAsset];
    require(lp != address(0), "Liquidity pool does not exist");
    LiquidityPool liquidityPool = LiquidityPool(lp);
  }
}
