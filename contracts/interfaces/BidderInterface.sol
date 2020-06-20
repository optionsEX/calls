pragma solidity >=0.5.0 <0.7.0;


interface BidderInterface {
    function receiveETH(address series, uint256 amount) external;
    function receiveUSD(address series, uint256 amount) external;
}
