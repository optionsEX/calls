pragma solidity >=0.5.0 <0.7.0;
import { ABDKMathQuad } from "./ABDKMathQUad.sol";

library OptionsCompute {
  using ABDKMathQuad for uint256;
  using ABDKMathQuad for bytes16;
  using ABDKMathQuad for int256;

  bytes16 private constant DECIMAL_PLACE = 0x403abc16d674ec800000000000000000;

  function computeEscrow(uint amount, uint strike)
    internal
    pure
    returns (uint)
  {
    bytes16 reducedAmount = amount.fromUInt().div(DECIMAL_PLACE);
    bytes16 strikeBytes = strike.fromUInt();
    bytes16 escrow = strikeBytes.mul(reducedAmount);
    return escrow.toUInt();
  }
}
