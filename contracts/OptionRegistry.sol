pragma solidity >=0.5.0 <0.7.0;

import "./tokens/ERC20.sol";
import "./tokens/OptionToken.sol";
import "./tokens/VariableSupplyToken.sol";
import { Types } from "./lib/Types.sol";

/// @author Brian Wheeler - (DSF Protocol)
contract OptionRegistry {

    string public constant VERSION = "1.0";
    address public ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    ERC20 public usdERC20;
    ERC20 public protocolToken;

    mapping(address => uint) public openInterest;
    mapping(address => uint) public earlyExercised;
    mapping(address => uint) public totalInterest;
    mapping(address => mapping(address => uint)) public writers;
    mapping(address => Types.OptionSeries) public seriesInfo;
    mapping(address => uint) public holdersSettlement;
    mapping(bytes32 => bool) public seriesExists;

    event OptionTokenCreated(address token);
    event SeriesRedeemed(address series, uint eth, uint usd);
    // Note, this just creates an option token, it doesn't guarantee
    // settlement of that token. For guaranteed settlement see the DSFProtocolProxy contract(s)
    function issue(address underlying, address strikeAsset, uint expiration, Types.Flavor flavor, uint strike) public returns (address) {
        require(expiration > now);
        require(strike > 1 ether);
        address u = underlying == address(0) ? ETH : underlying;
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
        require(now < series.expiration);

        if (series.flavor == Types.Flavor.Call) {
            require(msg.value == amount);
        } else {
            require(msg.value == 0);
            uint escrow = amount * series.strike;
            require(escrow / amount == series.strike);
            escrow /= 1 ether;
            require(usdERC20.transferFrom(msg.sender, address(this), escrow));
        }

        VariableSupplyToken(_series).grant(msg.sender, amount);

        openInterest[_series] += amount;
        totalInterest[_series] += amount;
        writers[_series][msg.sender] += amount;

        return true;
    }

    function close(address _series, uint amount) public returns (bool) {
        Types.OptionSeries memory series = seriesInfo[_series];

        require(now < series.expiration);
        require(openInterest[_series] >= amount);
        VariableSupplyToken(_series).burn(msg.sender, amount);

        require(writers[_series][msg.sender] >= amount);
        writers[_series][msg.sender] -= amount;
        openInterest[_series] -= amount;
        totalInterest[_series] -= amount;

        if (series.flavor == Types.Flavor.Call) {
            msg.sender.transfer(amount);
        } else {
            usdERC20.transfer(msg.sender, amount * series.strike / 1 ether);
        }
        return true;
    }

    function exercise(address _series, uint amount) public payable {
        Types.OptionSeries memory series = seriesInfo[_series];

        require(now < series.expiration);
        require(openInterest[_series] >= amount);
        VariableSupplyToken(_series).burn(msg.sender, amount);

        uint usd = amount * series.strike;
        require(usd / amount == series.strike);
        usd /= 1 ether;

        openInterest[_series] -= amount;
        earlyExercised[_series] += amount;

        if (series.flavor == Types.Flavor.Call) {
            msg.sender.transfer(amount);
            require(msg.value == 0);
            usdERC20.transferFrom(msg.sender, address(this), usd);
        } else {
            require(msg.value == amount);
            usdERC20.transfer(msg.sender, usd);
        }
    }


    function redeem(address _series) public returns (uint eth, uint usd) {
        Types.OptionSeries memory series = seriesInfo[_series];

        require(now > series.expiration, "Series did not expire");

        //TODO refactor for ERC20 underlying and other strikeAssets
        (eth, usd) = calculateWriterSettlement(writers[_series][msg.sender], _series);

        if (eth > 0) {
            msg.sender.transfer(eth);
        }

        if (usd > 0) {
            usdERC20.transfer(msg.sender, usd);
        }

        emit SeriesRedeemed(_series, eth, usd);
        return (eth, usd);
    }

    function calculateWriterSettlement(
        uint written,
        address _series
    ) public view returns (uint eth, uint usd) {
        Types.OptionSeries memory series = seriesInfo[_series];
        uint unsettledPercent = openInterest[_series] * 1 ether / totalInterest[_series];
        uint exercisedPercent = (totalInterest[_series] - openInterest[_series]) * 1 ether / totalInterest[_series];

        if (series.flavor == Types.Flavor.Call) {
            eth = written * unsettledPercent / 1 ether;
            usd = written * exercisedPercent / 1 ether;
            usd = usd * series.strike / 1 ether;
            return (eth, usd);
        } else {
            usd = written * unsettledPercent / 1 ether;
            usd = usd * series.strike / 1 ether;
            eth = written * exercisedPercent / 1 ether;
            return (eth, usd);
        }
    }

    function settle(address _series) public returns (uint usd) {
        Types.OptionSeries memory series = seriesInfo[_series];
        require(now > series.expiration);

        uint bal = ERC20(_series).balanceOf(msg.sender);
        VariableSupplyToken(_series).burn(msg.sender, bal);

        uint percent = bal * 1 ether / (totalInterest[_series] - earlyExercised[_series]);
        usd = holdersSettlement[_series] * percent / 1 ether;
        usdERC20.transfer(msg.sender, usd);
        return usd;
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
