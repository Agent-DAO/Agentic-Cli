export const base_config = {
  tokens: {
    GAS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    WGAS: '0x4200000000000000000000000000000000000006',
    ZERO: '0x0000000000000000000000000000000000000000',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    BVM: '0xd386a121991E51Eab5e3433Bf5B1cF4C8884b47a',
    OBMX: '0x3Ff7AB26F2dfD482C40bDaDfC0e88D01BFf79713',
    AERO: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    SCALE: '0x54016a4848a38f257B6E96331F7404073Fd9c32C',
  },
  gasSymbol: 'ETH',
  wGasSymbol: 'WETH',
  carbon: {
    carbonController: '0xfbF069Dbbf453C1ab23042083CFa980B3a672BbA',
    voucher: '0x907F03ae649581EBFF369a21C587cb8F154A0B84',
  },
  velocimeter: {
    grapheneRewarder: '0x9052385e624FC2907a22aDD19EC63eFd46c89e43',
  },
  utils: {
    multicall: '0xca11bde05977b3631167028862be2a173976ca11',
  },
  carbonApi: 'https://p01--graphene-backend--wlcfywkylwkq.code.run/v1/',
  mode: 'production',
} as const;