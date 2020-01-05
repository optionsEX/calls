pragma solidity >=0.5.0 <0.7.0;

import "./interfaces/IERC20.sol";
import "./lib/SafeMath.sol";

contract Exchange {

  using SafeMath for uint;

  bool private depositingTokenFlag; // True when Token.transferFrom is being called from depositToken

  mapping (address => mapping (address => uint)) public tokens; // mapping of token addresses to mapping of account balances (token=0 means Ether)
  mapping (address => mapping (bytes32 => bool)) public orders; // mapping of user accounts to mapping of order hashes to booleans (true = submitted by user, equivalent to offchain signature)

  event Order(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce, address user);
  event Deposit(address token, address user, uint amount, uint balance);

  /**
   * This function handles deposits of ERC20 based tokens to the contract.
   * Does not allow Ether.
   * If token transfer fails, transaction is reverted and remaining gas is refunded.
   * Emits a Deposit event.
   * Note: Remember to call Token(address).approve(this, amount) or this contract will not be able to do the transfer on your behalf.
   * @param token Ethereum contract address of the token or 0 for Ether
   * @param amount uint of the amount of the token the user wishes to deposit
   * @author forkdelta
   */
  function depositToken(address token, uint amount) public {
    require(token != address(0));
    depositingTokenFlag = true;
    require(IERC20(token).transferFrom(msg.sender, address(this), amount));
    depositingTokenFlag = false;
    tokens[token][msg.sender] = tokens[token][msg.sender].add(amount);
    emit Deposit(token, msg.sender, amount, tokens[token][msg.sender]);
  }

  /**
   * Retrieves the balance of a token based on a user address and token address.
   * @param token Ethereum contract address of the token or 0 for Ether
   * @param user Ethereum address of the user
   * @return the amount of tokens on the exchange for a given user address
   */
  function balanceOf(address token, address user) public view returns (uint) {
    return tokens[token][user];
  }

  /**
   * Stores the active order inside of the contract.
   * Emits an Order event.
   * Note: tokenGet & tokenGive can be the Ethereum contract address.
   * @param tokenGet Ethereum contract address of the token to receive
   * @param amountGet uint amount of tokens being received
   * @param tokenGive Ethereum contract address of the token to give
   * @param amountGive uint amount of tokens being given
   * @param expires uint of block number when this order should expire
   * @param nonce arbitrary random number
   */
  function order(address tokenGet, uint amountGet, address tokenGive, uint amountGive, uint expires, uint nonce) public {
    bytes32 hash = keccak256(abi.encodePacked(address(this), tokenGet, amountGet, tokenGive, amountGive, expires, nonce));
    orders[msg.sender][hash] = true;
    emit Order(tokenGet, amountGet, tokenGive, amountGive, expires, nonce, msg.sender);
  }
}
