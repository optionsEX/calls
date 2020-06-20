pragma solidity >=0.5.0 <0.7.0;

import "./interfaces/IUniswapFactory.sol";
import "./interfaces/IUniswapExchange.sol";
import "./tokens/UniversalERC20.sol";

contract PriceFeed {

    using UniversalERC20 for IERC20;
    IUniswapFactory public uniswapFactory;

    constructor(address _uniswapFactory) public {
      uniswapFactory = IUniswapFactory(_uniswapFactory);
    }

    function getPriceQuote(
       address fromToken,
       address toToken,
       uint256 amount
    ) public view returns(uint256) {
      return calculateUniswapReturn(IERC20(fromToken), IERC20(toToken), amount);
    }

    // @author Anton Bukov - (1Split)
    function calculateUniswapReturn(
       IERC20 fromToken,
       IERC20 toToken,
       uint256 amount
    ) internal view returns(uint256) {
       uint256 returnAmount = amount;

       if (!fromToken.isETH()) {
           IUniswapExchange fromExchange = uniswapFactory.getExchange(fromToken);
           if (fromExchange != IUniswapExchange(0)) {
               (bool success, bytes memory data) = address(fromExchange).staticcall{gas:200000}(
                   abi.encodeWithSelector(
                       fromExchange.getTokenToEthInputPrice.selector,
                       returnAmount
                   )
               );
               if (success) {
                   returnAmount = abi.decode(data, (uint256));
               } else {
                   returnAmount = 0;
               }
           }
       }

       if (!toToken.isETH()) {
           IUniswapExchange toExchange = uniswapFactory.getExchange(toToken);
           if (toExchange != IUniswapExchange(0)) {
               (bool success, bytes memory data) = address(toExchange).staticcall{gas : 200000}(
                   abi.encodeWithSelector(
                       toExchange.getEthToTokenInputPrice.selector,
                       returnAmount
                   )
               );
               if (success) {
                   returnAmount = abi.decode(data, (uint256));
               } else {
                   returnAmount = 0;
               }
           }
       }

       return returnAmount;
   }

}
