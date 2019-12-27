pragma solidity >=0.5.0 <0.7.0;
import "./ABDKMathQuad.sol";
import "./NormalDist.sol";

contract BlackScholes is NormalDist {
    using ABDKMathQuad for uint256;
    using ABDKMathQuad for bytes16;
    using ABDKMathQuad for int256;

    bytes16 private constant DAYS_365 = 0x40076d00000000000000000000000000;
    bytes16 private constant NEGATIVE_ONE = 0xbfff0000000000000000000000000000;
    bytes16 private constant TWO = 0x40000000000000000000000000000000;
    bytes16 ONE_YEAR_SECONDS = 0x4017e187e00000000000000000000000;

    enum Flavor {
        Call,
        Put
    }

    struct Intermediates {
      bytes16 d1Right;
      bytes16 d1Left;
      bytes16 d1Numerator;
      bytes16 d1Denominator;
      bytes16 d1;
      bytes16 eToNegRT;
    }

    /**
     * @dev sqrt calculates the square root of a given number x
     * @dev for precision into decimals the number must first
     * @dev be multiplied by the precision factor desired
     * @param x uint256 number for the calculation of square root
     */
    function sqrt(uint256 x) public pure returns (uint256) {
        uint256 c = (x + 1) / 2;
        uint256 b = x;
        while (c < b) {
            b = c;
            c = (x / c + c) / 2;
        }
        return b;
    }


    function testNorm(uint x) public returns(uint256) {
        return stdNormCDF(x);
    }

    function callOptionPrice(
        bytes16 d1,
        bytes16 d1Denominator,
        bytes16 price,
        bytes16 strike,
        bytes16 eToNegRT
    ) internal view returns (bytes16) {
        bytes16 d2 = d1.sub(d1Denominator);
        bytes16 cdfD1 = cdf(d1);
        bytes16 cdfD2 = cdf(d2);
        bytes16 priceCdf = price.mul(cdfD1);
        bytes16 strikeBy = strike.mul(eToNegRT).mul(cdfD2);
        return priceCdf.sub(strikeBy);
    }

    function putOptionPrice(
        bytes16 d1,
        bytes16 d1Denominator,
        bytes16 price,
        bytes16 strike,
        bytes16 eToNegRT
    ) internal view returns (bytes16) {
        bytes16 d2 = d1Denominator.sub(d1);
        bytes16 cdfD1 = cdf(d1.neg());
        bytes16 cdfD2 = cdf(d2);
        bytes16 priceCdf = price.mul(cdfD1);
        bytes16 strikeBy = strike.mul(eToNegRT).mul(cdfD2);
        return strikeBy.sub(priceCdf);
    }

    /**
     * @dev retBlackScholesCalc returns the black scholes theoretical price for an option
     * @param strike uint256 strike price of the underlying
     * @param price uint256 price of the underlying asset
     * @param expiration uint256 expiration time of option as a unix timestamp
     * @param vol uint256 volatility passed in as decimal * 100
     * @param rfr uint256 risk free rate as a decimal * 100
     * @param flavor Flavor Call|Put
     */

    function retBlackScholesCalc(
        uint price,
        uint strike,
        uint expiration,
        uint vol,
        uint rfr,
        Flavor flavor
    ) public view returns (uint) {
        bytes16 HUNDRED = uint(100).fromUInt();
        bytes16 dec = uint(10**18).fromUInt();
        bytes16 res = blackScholesCalc(
          price.fromUInt().div(dec),
          strike.fromUInt().div(dec),
          uint(expiration - now).fromUInt().div(ONE_YEAR_SECONDS),
          uint(vol).fromUInt().div(HUNDRED),
          uint(rfr).fromUInt().div(HUNDRED),
          flavor
         );
         return res.mul(HUNDRED).toUInt();
    }

    function getIntermediates(
          bytes16 price,
          bytes16 strike,
          bytes16 time,
          bytes16 vol,
          bytes16 rfr
    ) internal pure returns (Intermediates memory) {
      bytes16 d1Right = vol.mul(vol).div(TWO).add(rfr).mul(time);
      bytes16 d1Left = price.div(strike).ln();
      bytes16 d1Numerator = d1Left.add(d1Right);
      bytes16 d1Denominator = vol.mul(time.sqrt());
      return Intermediates({
            d1Right: d1Right,
            d1Left: d1Left,
            d1Numerator: d1Numerator,
            d1Denominator: d1Denominator,
            d1: d1Numerator.div(d1Denominator),
            eToNegRT: rfr.mul(time).neg().exp()
        });
    }

    function blackScholesCalc(
         bytes16 price,
         bytes16 strike,
         bytes16 time,
         bytes16 vol,
         bytes16 rfr,
         Flavor flavor
    ) public view returns (bytes16) {
        Intermediates memory i = getIntermediates(price, strike, time, vol, rfr);

        if (flavor == Flavor.Call) {
            return callOptionPrice(i.d1, i.d1Denominator, price, strike, i.eToNegRT);
        } else {
            return putOptionPrice(i.d1, i.d1Denominator, price, strike, i.eToNegRT);
        }
    }

    /**
     * @dev stddev calculates the standard deviation for an array of integers
     * @dev precision is the same as sqrt above meaning for higher precision
     * @dev the decimal place must be moved prior to passing the params
     * @param numbers uint[] array of numbers to be used in calculation
     */
    function stddev(uint[] memory numbers) public pure returns (uint256 sd) {
        uint sum = 0;
        for(uint i = 0; i < numbers.length; i++) {
            sum += numbers[i];
        }
        uint256 mean = sum / numbers.length;        // Integral value; float not supported in Solidity
        sum = 0;
        for(uint i = 0; i < numbers.length; i++) {
            sum += (numbers[i] - mean) ** 2;
        }
        sd = sqrt(sum / (numbers.length - 1));      //Integral value; float not supported in Solidity
        return sd;
    }


    /**
     * @dev blackScholesEstimate calculates a rough price estimate for an ATM option
     * @dev input parameters should be transformed prior to being passed to the function
     * @dev so as to remove decimal places otherwise results will be far less accurate
     * @param _vol uint256 volatility of the underlying converted to remove decimals
     * @param _underlying uint256 price of the underlying asset
     * @param _time uint256 days to expiration in years multiplied to remove decimals
     */
    function blackScholesEstimate(
        uint256 _vol,
        uint256 _underlying,
        uint256 _time
    ) public pure returns (uint256 estimate) {
        estimate = 40 * _vol * _underlying * sqrt(_time);
        return estimate;
    }

    /**
     * @dev fromReturnsBSestimate first calculates the stddev of an array of price returns
     * @dev then uses that as the volatility param for the blackScholesEstimate
     * @param _numbers uint256[] array of price returns for volatility calculation
     * @param _underlying uint256 price of the underlying asset
     * @param _time uint256 days to expiration in years multiplied to remove decimals
     */
    function retBasedBlackScholesEstimate(
        uint256[] memory _numbers,
        uint256 _underlying,
        uint256 _time
    ) public pure {
        uint _vol = stddev(_numbers);
        blackScholesEstimate(_vol, _underlying, _time);
    }

}
