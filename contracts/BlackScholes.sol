pragma solidity >=0.5.0 <0.7.0;
import "./ABDKMathQuad.sol";
import "./NormalDist.sol";

contract BlackScholesEstimate {
    using ABDKMathQuad for uint256;
    using ABDKMathQuad for bytes16;
    using ABDKMathQuad for int256;

    bytes16 private constant DAYS_365 = 0x40076d00000000000000000000000000;
    bytes16 private constant NEGATIVE_ONE = 0xbfff0000000000000000000000000000;
    bytes16 private constant TWO = 0x40000000000000000000000000000000;

    NormalDist public normalDist;

    enum Flavor {
        Call,
        Put
    }

    constructor(address _normalDist) public {
        normalDist = NormalDist(_normalDist);
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
        return normalDist.stdNormCDF(x);
    }

    function callOptionPrice(
        bytes16 d1,
        bytes16 d1Denominator,
        bytes16 price,
        bytes16 strike,
        bytes16 eToNegRT
    ) internal view returns (bytes16) {
        bytes16 d2 = d1.sub(d1Denominator);
        bytes16 cdfD1 = normalDist.cdf(d1);
        bytes16 cdfD2 = normalDist.cdf(d2);
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
        bytes16 cdfD1 = normalDist.cdf(d1.neg());
        bytes16 cdfD2 = normalDist.cdf(d2);
        bytes16 priceCdf = price.mul(cdfD1);
        bytes16 strikeBy = strike.mul(eToNegRT).mul(cdfD2);
        return strikeBy.sub(priceCdf);
    }

    function blackScholesCalc(
         bytes16 price,
         bytes16 strike,
         bytes16 time,
         bytes16 vol,
         bytes16 rfr,
         Flavor flavor
    ) public view returns (bytes16) {
        bytes16 d1Right = vol.mul(vol).div(TWO).add(rfr).mul(time);
        bytes16 d1Left = price.div(strike).ln();
        bytes16 d1Numerator = d1Left.add(d1Right);
        bytes16 d1Denominator = vol.mul(time.sqrt());
        bytes16 d1 = d1Numerator.div(d1Denominator);
        bytes16 eToNegRT = rfr.mul(time).neg().exp();

        if (flavor == Flavor.Call) {
            return callOptionPrice(d1, d1Denominator, price, strike, eToNegRT);
        //    bytes16 d2 = d1.sub(d1Denominator);
        //    bytes16 cdfD1 = normalDist.cdf(d1);
        //    bytes16 cdfD2 = normalDist.cdf(d2);
        //    bytes16 priceCdf = price.mul(cdfD1);
        //    bytes16 strikeBy = strike.mul(eToNegRT).mul(d2);
        //    return priceCdf.sub(strikeBy);
        } else {
            return putOptionPrice(d1, d1Denominator, price, strike, eToNegRT);
        //    bytes16 d2 = d1Denominator.sub(d1);
        //    bytes16 cdfD1 = normalDist.cdf(d1.neg());
        //    bytes16 cdfD2 = normalDist.cdf(d2);
        //    bytes16 priceCdf = price.mul(cdfD1);
        //    bytes16 strikeBy = strike.mul(eToNegRT).mul(d2);
        //    return strikeBy.sub(priceCdf);
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
