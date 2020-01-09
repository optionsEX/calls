pragma solidity >=0.5.0 <0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IERC20.sol";
import "./tokens/OptionToken.sol";
import "./tokens/SafeERC20.sol";
import { Types } from "./lib/Types.sol";
import { Constants } from "./lib/Constants.sol";

/// @author Brian Wheeler - (DSF Protocol)
contract OptionRegistry {

    using SafeERC20 for IERC20;
    string public constant VERSION = "1.0";

    IERC20 public usdERC20;
    IERC20 public protocolToken;

    mapping(address => uint) public openInterest;
    mapping(address => uint) public earlyExercised;
    mapping(address => uint) public totalInterest;
    mapping(address => mapping(address => uint)) public writers;
    mapping(address => Types.OptionSeries) public seriesInfo;
    mapping(address => uint) public holdersSettlement;
    mapping(bytes32 => bool) public seriesExists;

    event OptionTokenCreated(address token);
    event SeriesRedeemed(address series, uint underlyingAmount, uint strikeAmount);
    // Note, this just creates an option token, it doesn't guarantee
    // settlement of that token. For guaranteed settlement see the DSFProtocolProxy contract(s)
    function issue(address underlying, address strikeAsset, uint expiration, Types.Flavor flavor, uint strike) public returns (address) {
        require(expiration > now, "Already expired");
        require(strike > 1 ether, "Strike is not greater than 1");
        address u = underlying == address(0) ? Constants.ethAddress() : underlying;
        address s = strikeAsset == address(0) ? address(usdERC20) : strikeAsset;
        bytes32 issuanceHash = getIssuanceHash(underlying, strikeAsset, expiration, flavor, strike);
        require(seriesExists[issuanceHash] == false, "Series already exists");
        address series = address(new OptionToken(issuanceHash));
        seriesInfo[series] = Types.OptionSeries(expiration, flavor, strike, u, s);
        seriesExists[issuanceHash] = true;
        emit OptionTokenCreated(series);
        return series;
    }

    function open(address _series, uint amount) public payable returns (bool) {
        Types.OptionSeries memory series = seriesInfo[_series];
        require(now < series.expiration, "Options can not be opened after expiration");

        if (series.flavor == Types.Flavor.Call) {
          openCall(series.underlying, amount);
        } else {
          openPut(series.strikeAsset, amount, series.strike);
        }

        OptionToken(_series).mint(msg.sender, amount);

        openInterest[_series] += amount;
        totalInterest[_series] += amount;
        writers[_series][msg.sender] += amount;

        return true;
    }

    function close(address _series, uint amount) public returns (bool) {
        Types.OptionSeries memory series = seriesInfo[_series];

        require(now < series.expiration);
        require(openInterest[_series] >= amount);
        OptionToken(_series).burnFrom(msg.sender, amount);

        require(writers[_series][msg.sender] >= amount, "Caller did not write sufficient amount");
        writers[_series][msg.sender] -= amount;
        openInterest[_series] -= amount;
        totalInterest[_series] -= amount;

        if (series.flavor == Types.Flavor.Call) {
          transferOutUnderlying(series, amount);
        } else {
          usdERC20.safeTransfer(msg.sender, amount * series.strike / 1 ether);
        }
        return true;
    }

    function exercise(address _series, uint amount) public payable {
        Types.OptionSeries memory series = seriesInfo[_series];

        require(now < series.expiration, "Series already expired");
        require(openInterest[_series] >= amount, " Amount greater than open interest");
        OptionToken(_series).burnFrom(msg.sender, amount);

        uint exerciseAmount = amount * series.strike;
        require(exerciseAmount / amount == series.strike, "Exercise amount does not balance");
        exerciseAmount /= 1 ether;

        openInterest[_series] -= amount;
        earlyExercised[_series] += amount;

        if (series.flavor == Types.Flavor.Call) {
          exerciseCall(series, amount, exerciseAmount);
        } else {
          exercisePut(series, amount, exerciseAmount);
        }
    }


    function redeem(address _series) public returns (uint underlying, uint strikeAsset) {
        Types.OptionSeries memory series = seriesInfo[_series];

        require(now > series.expiration, "Series did not expire");

        (underlying, strikeAsset) = calculateWriterSettlement(writers[_series][msg.sender], _series);

        if (underlying > 0) {
          transferOutUnderlying(series, underlying);
        }

        if (strikeAsset > 0) {
          transferOutStrike(series, strikeAsset);
        }

        emit SeriesRedeemed(_series, underlying, strikeAsset);
        return (underlying, strikeAsset);
    }

    function calculateWriterSettlement(
        uint written,
        address _series
    ) public view returns (uint underlying, uint strikeAsset) {
        Types.OptionSeries memory series = seriesInfo[_series];
        uint unsettledPercent = openInterest[_series] * 1 ether / totalInterest[_series];
        uint exercisedPercent = (totalInterest[_series] - openInterest[_series]) * 1 ether / totalInterest[_series];

        if (series.flavor == Types.Flavor.Call) {
            underlying = written * unsettledPercent / 1 ether;
            strikeAsset = written * exercisedPercent / 1 ether;
            strikeAsset = strikeAsset * series.strike / 1 ether;
            return (underlying, strikeAsset);
        } else {
            strikeAsset = written * unsettledPercent / 1 ether;
            strikeAsset = strikeAsset * series.strike / 1 ether;
            underlying = written * exercisedPercent / 1 ether;
            return (underlying, strikeAsset);
        }
    }

    function settle(address _series) public returns (uint usd) {
        Types.OptionSeries memory series = seriesInfo[_series];
        require(now > series.expiration);

        uint bal = IERC20(_series).balanceOf(msg.sender);
        OptionToken(_series).burnFrom(msg.sender, bal);

        uint percent = bal * 1 ether / (totalInterest[_series] - earlyExercised[_series]);
        usd = holdersSettlement[_series] * percent / 1 ether;
        usdERC20.safeTransfer(msg.sender, usd);
        return usd;
    }

    function openCall(address underlying, uint amount) internal {
      if(underlying == Constants.ethAddress()) require(msg.value == amount);
      else IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
    }

    function openPut(address strikeAsset, uint amount, uint strike) internal {
      if (strikeAsset != Constants.ethAddress()) {
        require(msg.value == 0, "msg.value is not zero");
        uint escrow = amount * strike;
        require(escrow / amount == strike, "escrow does not balance");
        escrow /= 1 ether;
        IERC20(strikeAsset).safeTransferFrom(msg.sender, address(this), escrow);
      } else {
        uint escrow = amount * strike;
        require(escrow / amount == strike, "escrow does not balance");
        escrow /= 1 ether;
        require(msg.value == escrow, "msg.value does not match escrow");
      }
    }

    function exerciseCall(Types.OptionSeries memory _series, uint amount, uint exerciseAmount) internal {
      if (_series.underlying == Constants.ethAddress()) {
        msg.sender.transfer(amount);
        require(msg.value == 0);
        IERC20(_series.strikeAsset).safeTransferFrom(msg.sender, address(this), exerciseAmount);
      } else {
        IERC20(_series.underlying).safeTransfer(msg.sender, amount);
        IERC20(_series.strikeAsset).safeTransferFrom(msg.sender, address(this), exerciseAmount);
      }
    }

    function exercisePut(Types.OptionSeries memory _series, uint amount, uint exerciseAmount) internal {
      if (_series.underlying == Constants.ethAddress()) {
        require(msg.value == amount);
        IERC20(_series.strikeAsset).safeTransfer(msg.sender, exerciseAmount);
      } else {
        IERC20(_series.underlying).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(_series.strikeAsset).safeTransfer(msg.sender, exerciseAmount);
      }
    }

   function transferOutUnderlying(Types.OptionSeries memory _series, uint amount) internal {
      if (_series.underlying == Constants.ethAddress()) {
        msg.sender.transfer(amount);
      } else {
        IERC20(_series.underlying).safeTransfer(msg.sender, amount);
      }
    }

   function transferOutStrike(Types.OptionSeries memory _series, uint amount) internal {
     if (_series.strikeAsset == Constants.ethAddress()) {
       msg.sender.transfer(amount);
     } else {
       IERC20(_series.strikeAsset).safeTransfer(msg.sender, amount);
     }
   }

    /**
     * Helper function for computing the hash of a given issuance.
     */
    function getIssuanceHash(address underlying, address strikeAsset, uint expiration, Types.Flavor flavor, uint strike)
      internal
      pure
      returns(bytes32)
    {
      return keccak256(
         abi.encodePacked(underlying, strikeAsset, expiration, flavor, strike)
      );
    }

    function _min(uint a, uint b) pure public returns (uint) {
        if (a > b)
            return b;
        return a;
    }

    function _max(uint a, uint b) pure public returns (uint) {
        if (a > b)
            return a;
        return b;
    }
}
