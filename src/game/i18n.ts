import { ITEMS, type ItemId, type ShopKind } from './items'
import type { ZoneId } from './store'

export type UiLanguage = 'en' | 'ko'

const KO: Record<string, string> = {
  'GAME GUIDE': '게임 안내', 'BEGIN TOUR': '튜토리얼 시작', 'RETURN TO LOBBY': '로비로 돌아가기', 'MARKET CORRECTION': '시세 변동',
  'HAND GATHERING': '맨손 채집',
  'COMMON': '로비', 'PLAZA': '로비', 'FOREST': '숲', 'FORAGE': '채집', 'FARM': '농장', 'MINE': '광산',
  'COMMON SHOP': '상점', 'GENERAL SHOP': '상점', 'PRODUCE STAND': '농작물 판매', 'CROP MARKET': '농작물 판매', 'FOOD MARKET': '요리 판매',
  'FORAGING SHOP': '채집 도구', 'FORAGE SHOP': '채집 도구',
  'FORAGE MARKET': '채집품 판매', 'FARM SHOP': '농장 용품', 'MINING SHOP': '채광 도구',
  'ORE STAND': '광석 판매', 'ORE MARKET': '광석 판매',
  'WANDERING BROKER': '떠돌이 정보상', 'INFO MERCHANT': '떠돌이 정보상',
  'YOUR PLOT': '내 텃밭', 'YOUR FARM': '내 텃밭', 'YOUR BAY': '내 구역', 'HOME': '로비',

  'PLAYERS': '플레이어', 'MENU': '메뉴', 'SETTINGS': '설정', 'LANGUAGE': '언어', 'GRAPHICS': '그래픽', 'AUTO': '자동', 'LOW': '낮음', 'MEDIUM': '보통', 'HIGH': '높음',
  'ENGLISH': 'English', 'KOREAN': '한국어', 'INVENTORY': '가방', 'PACK': '가방',
  'COOKBOOK': '레시피', 'RECIPES': '레시피', 'RECIPE BOX': '레시피 상자', 'LOTTERY': '복권', 'TRAVEL': '이동', 'STOCKS': '주식', 'STOCK EXCHANGE': '주식',
  'TRADE': '거래', 'RESULTS': '결과', 'LEADERBOARD': '순위표', 'PRIZES': '보상',
  'REWARDS': '보상', 'SCORE': '점수', 'READY': '준비 완료', 'UNREADY': '준비 해제',
  'NOT READY': '준비 해제', 'WAITING': '대기 중', 'LOADING': '불러오는 중',
  'SUBMIT': '납품', 'COOK': '요리', 'SELL': '판매', 'BUY': '구매', 'CLOSE': '닫기',
  'BUY: LMB': '구매: 좌클릭', 'SELL: LMB': '판매: 좌클릭', 'SELL: RMB': '판매: 우클릭', '10×: SHIFT+CLICK': '10개: Shift+클릭', '×10: SHIFT': '10개씩: Shift',
  'TIME LEFT': '남은 시간', 'MATCH TIME': '남은 시간', 'RESTOCK': '재입고', 'MARKET NEWS': '시장 뉴스', 'BREAKING NEWS': '속보', 'MARKETS SHIFT SHARPLY': '여러 시세가 크게 움직였습니다',
  'COLLECT ALL': '모두 받기', '3 COOKING SLOTS': '조리 예약 3칸', 'DISHES PER BATCH': '한 번에 조리',
  'MASTER': '전체', 'MUSIC': '음악', 'AMBIENCE': '환경음', 'EFFECTS': '효과음',
  'SENSITIVITY': '감도', 'SHIFT LOCK': '시점 고정', 'INVERT Y': 'Y축 반전',
  'LOCK': '시점 고정', 'HOTBAR': '단축바', 'CAMERA SENSITIVITY': '카메라 감도',

  'HOW TO PLAY': '게임 안내',
  'THE GOAL': '승리 조건', 'FORAGING & MINING': '채집과 채광', 'FARM & COOK': '농사와 요리', 'UPGRADES': '장비 강화',
  'SHOP & LOTTERY': '상점과 복권', 'MARKETS': '시세', 'EVENTS & TRADE': '미니게임과 거래',
  'MOST COINS WINS': '코인을 가장 많이 모으면 승리', 'CASH COUNTS AT THE FINISH': '종료 시 보유 코인으로 순위를 정합니다', 'FINAL CASH': '최종 보유금',
  'KEEP RUNNING': '농사·요리 계속', 'WHILE CROPS GROW': '작물이 자라는 동안', 'OR': '또는',
  'FREE START · GATHER AND SELL': '무료로 시작 · 채집해서 판매', 'GROW · COOK · SELL DISHES': '재배 · 요리 · 판매',
  'TOOLS · DEPTH · RARE ORES': '장비 · 깊이 · 희귀 광석', 'MOVE': '이동', 'SPRINT': '달리기', 'VIEW LOCK': '시점 고정',
  'START HERE': '여기서 시작', 'HARVEST A WHOLE TREE · SELL AT THE FOREST STAND': '나무 한 그루의 과일을 모아 채집품 판매대에 파세요',
  'BY HAND': '맨손', 'FORTUNE': '추가 획득', 'RARE FINDS': '희귀 채집품', 'RARE FINDS AND FARM SEEDS MAY DROP': '희귀 채집품이나 농장 씨앗이 나올 수도 있습니다',
  'WATER ONCE': '한 번 물주기', 'COLLECT': '받기', 'CROPS': '작물', 'COLLECT AND SELL': '받아서 판매',
  'BUY A DEED · PLANT · WATER ONCE · HARVEST': '농장 계약서 구매 · 심기 · 한 번 물주기 · 수확',
  'RECIPE BOXES UNLOCK DISHES': '레시피 상자로 새 요리를 배웁니다',
  'COLLECT FINISHED DISHES · SELL AT THE FOOD MARKET': '완성된 요리를 받아 요리 판매대에 파세요',
  'SHALLOW': '입구', 'MID CAVE': '중간', 'DEEP': '깊은 곳',
  'HOLD LMB': '좌클릭 길게', 'DEEPER MEANS RARER': '깊을수록 희귀',
  'FACE ORE AND HOLD LMB · DEPTH CHANGES CHANCES': '광석을 보고 좌클릭 유지 · 깊을수록 희귀 광석 확률이 높아집니다',
  'SAVE LEVEL': '단계 보호', 'SAFE ON FAIL': '실패 시 보호', 'UPGRADE DISCOUNT': '강화 비용 할인', 'MINE FASTER': '채광 속도', 'MORE DROPS': '추가 획득', 'COOK FASTER': '조리 단축', 'WATER FARM': '농장 물주기',
  'KEEP LEVEL ON FAIL': '실패해도 단계 유지', 'ONE UPGRADE 30% OFF': '강화 1회 30% 할인', '+12% MINING SPEED': '채광 속도 +12%',
  'BETTER MULTI-DROPS': '추가 획득 확률 증가', 'SHORTEN ACTIVE COOKS': '조리 중인 요리 단축', 'WATERS ONE FARM': '농장 한 곳 전체 물주기',
  'TRAVELING MERCHANT': '떠돌이 상인', 'LIMITED ITEMS': '한정 아이템',
  'PREVENTS ONE LEVEL DROP': '실패 시 단계 하락 방지', 'DISCOUNTS ONE UPGRADE': '강화 비용 30% 할인',
  'FASTER MINING FOR YOU': '내 채광 속도 증가', 'BETTER YIELD FOR YOU': '내 추가 획득 확률 증가',
  'SHORTENS YOUR COOK QUEUE': '내 조리 시간을 단축', 'WATERS ONE OF YOUR FARMS': '내 농장 한 곳에 물주기',
  'A TRAVELING MERCHANT SOMETIMES CARRIES LIMITED ITEMS': '떠돌이 상인이 가끔 한정 아이템을 판매합니다',
  '2 MATCHES': '2개 일치', '3 MATCHES': '3개 일치',
  'PREVIEW': '미리 보기', 'YOUR FIRST FARM': '첫 개인 농장', 'BUY AFTER YOUR PERSONAL DEED': '개인 농장을 산 뒤 구매 가능',
  'UNLOCKS ONE RANDOM RECIPE': '무작위 레시피 하나 획득', 'CHOOSE 3 OF 12 · MATCH 2 OR 3': '1~12 중 숫자 3개 선택 · 2개 또는 3개 일치',
  'LAST 5 PRICES': '최근 가격 5회',
  'PRICE HISTORY': '가격 기록', 'PRICE UPDATED': '가격이 바뀌었습니다',
  'SELLING LOWERS PRICE': '팔수록 가격 하락', 'MARKET CYCLE': '시세 갱신',
  'SUPPLY & DEMAND': '수요와 공급', 'SELLING PUSHES THAT ITEM PRICE DOWN · DEMAND RECOVERS': '많이 팔면 가격이 내려가고 시간이 지나면 회복됩니다',
  'EVERY 15 MINUTES THE MARKET CAN CHANGE SHARPLY': '15분마다 시세를 크게 바꾸는 소식이 생깁니다',
  'EVERY 20 MINUTES': '20분마다',
  'EVENTS': '미니게임', 'SAME EVENT GEAR': '동일 장비', 'PLAYER TRADES': '플레이어 거래', 'SELL BEFORE FINISH': '종료 전 매도', 'SELL STOCKS BEFORE FINISH': '종료 전 주식 매도',
  'READY UP · TEMPORARY ITEMS · CASH AND ITEM PRIZES': '준비 완료 · 모두 같은 임시 장비 · 코인과 아이템 보상',
  'OPEN PLAYERS TO TRADE ITEMS OR COINS': '플레이어 목록에서 아이템과 코인을 거래할 수 있습니다',
  'SELL STOCKS BEFORE TIME ENDS · FINAL CASH WINS': '종료 전에 주식을 팔아 두세요 · 마지막 보유 코인으로 승부합니다',
  'BACK': '이전', 'CONTINUE': '다음', 'SKIP': '건너뛰기', 'PLAYER': '플레이어',

  'CLEAR': '맑음', 'RAIN': '비', 'MIST': '안개', 'SUNNY': '화창', 'BREEZE': '산들바람',
  'FORAGING': '채집', 'MINING': '채광', 'FARMING': '농사', 'COOKING': '조리 중',
  'PLANT': '심기', 'WATER': '물주기', 'HARVEST': '수확', 'DELIVER': '납품', 'EQUIP WATERING CAN': '물뿌리개 선택',
  'ORDER': '주문', 'INGREDIENTS': '재료', 'TIME BONUS': '시간 보너스', 'DELIVERED': '납품 완료',
  'COMPLETE': '완료', 'COMPLETED': '완료', 'EXPIRED': '시간 초과',
  'MINING RUSH': '채광 대회', 'KITCHEN RUSH': '요리 대회', 'FORAGE RACE': '채집 경주',
  'PLOT': '텃밭', 'FRUIT': '과일', 'APPLE': '사과', 'APPLES': '사과', 'ORANGE': '오렌지', 'ORANGES': '오렌지',
  'TRUFFLE': '트러플', 'DISCOVERY': '유물', 'DONE': '완료',
  '1ST': '1등', '2ND': '2등', '3RD': '3등', '4TH': '4등', '5TH': '5등', '6TH': '6등',

  'UPGRADE': '강화', 'ENHANCE': '강화', 'CURRENT': '현재', 'NEXT': '강화 후',
  'AFTER UPGRADE': '강화 후', 'SUCCESS': '성공 확률', 'SUCCESS RATE': '성공 확률', 'FAILED': '강화 실패',
  'MAX LEVEL': '최대 단계', 'ORE YIELD': '광석 획득 확률', 'ORE YIELD CHANCES': '광석 획득 확률',
  'HARVEST YIELD': '추가 수확 확률', 'HARVEST YIELD CHANCES': '추가 수확 확률',
  'TOOLS': '도구', 'FARMS': '농장', 'MINING SPEED': '채광 속도', 'STORAGE': '가방 용량', 'CAPACITY': '가방 용량', 'COST': '강화 비용',
  '30% OFF': '30% 할인', 'OWNED': '보유', 'NEED MATERIALS': '재료 부족', 'NEED COINS': '코인 부족',
  'NEED BOTH': '재료 및 코인 부족', 'NEED ITEMS + COINS': '재료 및 코인 부족',
  'FAILURE KEEPS +3': '실패 시 +3 유지', 'FAILURE DROPS TO +2': '실패 시 +2 하락',

  'NOT ENOUGH COINS': '코인 부족', 'MISSING INGREDIENTS': '재료 부족', 'FURNACE QUEUE FULL': '요리 대기열 가득 참',
  'COOKING QUEUE FULL': '요리 대기열 가득 참', 'DISH NOT READY': '요리 미완성', 'ORDER EXPIRED': '주문 시간 초과',
  'STARTING…': '조리 시작 중…', 'FURNACE UNAVAILABLE': '화덕을 사용할 수 없습니다', 'COLLECTING…': '받는 중…',
  'SALE PENDING': '판매 처리 중', 'MARKET UNAVAILABLE': '시세 정보 없음', 'ORDER PENDING': '주문 처리 중',
  'INVENTORY CHANGED': '보유 수량이 변경됨', 'BALANCE CHANGED': '보유 코인이 변경됨', 'HOLDINGS CHANGED': '보유 주식이 변경됨',
  'TRADE FAILED': '거래 실패', 'SESSION REPLACED': '접속 상태가 변경됨', 'OFFER IS NO LONGER VALID': '제안이 만료됨',
  'INVALID PURCHASE': '구매할 수 없음', 'WRONG SHOP': '이 상점에서는 살 수 없음', 'USE THE DEED COUNTER': '농장 계약 창구를 이용하세요',
  'CLOSED': '이용할 수 없음', 'NOT-OWNED': '보유 수량 부족', 'SOLD-OUT': '품절', 'NOT-ENOUGH-CASH': '코인 부족',
  'MARKET CLOSED': '거래 마감',
  'NEEDS WATER': '물 필요', 'CHOOSE A SEED': '씨앗 선택', 'READY TO HARVEST': '수확 가능',
  'NOTHING TO HARVEST': '수확물 없음', 'MOVE CLOSER': '더 가까이 가세요',
  'FARM ALREADY CLAIMED': '주인 있는 텃밭', 'PLOT ALREADY CLAIMED': '주인 있는 텃밭',
  'NOT YOUR FARM': '남의 텃밭', 'NOT YOUR PLOT': '남의 텃밭', 'TRADE COMPLETE': '거래 완료',
  'RECIPE UNLOCKED!': '새 레시피!', 'ALL RECIPES LEARNED': '모든 레시피 습득 완료', 'UNLOCKED': '잠금 해제!', 'RETURNED TO PLAZA': '로비로 이동',
  'SOLD OUT': '품절', 'NO STOCK': '재고 없음', 'NONE OWNED': '미보유', '0 OWNED': '미보유',
  'NO DISHES YET': '판매할 요리 없음',
  'NO MATCHING ORDER': '제출할 주문 없음', 'NOTHING READY': '완성된 요리 없음', 'NONE READY': '완성된 요리 없음',
  'NO RECIPES YET': '배운 레시피 없음', 'NO ONE ELSE ONLINE': '접속 중인 플레이어 없음',
  'STANDARD': '일반', 'GOLD': '고급', 'GRAND': '특급', 'NEXT DRAW': '다음 추첨', 'NO TICKETS': '복권 없음',
  'WANDERING MERCHANT': '떠돌이 상인', 'INFORMATION': '정보', 'NO INFORMATION': '정보 없음',
  'NO MORE INFORMATION': '남은 정보 없음',
  'INFO 1': '정보 1', 'INFO 2': '정보 2',
  'ACCEPT': '수락', 'NO': '거절', 'CANCEL': '취소', 'YOU': '나', 'ADD ITEM': '아이템 추가', 'MAX': '전부', 'BUY A TOOL FIRST': '먼저 도구를 구매하세요',
  'NAME': '이름', 'TIME': '시간', 'GAME SETUP': '게임 설정', 'EXTRA FARMS': '추가 농장', 'START GAME': '게임 시작', 'CONNECTING': '연결 중',
  'WAITING FOR HOST': '호스트 대기 중', 'PERSONAL': '개인', 'SHARED': '공용', 'LEFT': '남음', 'AVAILABLE': '구매 가능', 'LEARNING': '안내 중',
  'BUY PERSONAL DEED FIRST': '먼저 개인 농장을 구매하세요',
  'READY!': '준비 완료!', 'READY UP': '준비', 'EVENT READY': '이벤트 준비', 'STARTING': '곧 시작',
  'MINING CONTEST': '채광 대회', 'COOKING CONTEST': '요리 대회', 'GATHERING RACE': '채집 경주',
  'MINE ORES FOR POINTS': '광석을 캐서 점수를 얻으세요', 'GROW COOK AND SUBMIT ORDERS': '재배하고 요리해 주문을 제출하세요', 'GATHER AND DELIVER FIRST': '먼저 모아 배달하세요',
  'FINAL LEDGER': '최종 순위', 'FORAGED': '채집', 'MINED': '채광', 'HARVESTED': '수확',
  'SOLD': '판매', 'NEW RUN': '새 게임', 'GEAR': '장비', 'RESULT': '결과', 'UPGRADED': '강화 성공',
  'ORE CHANCES': '광석 획득 확률', 'HARVEST CHANCES': '추가 수확 확률', 'OF': '/', 'ON': '사용 중',
  'USES': '회', 'OWN': '보유', 'DISMISS MINIGAME REWARD': '보상 닫기', 'NICKNAME': '닉네임',
  'WATERS ONE PLANTED CROP.': '심은 작물 하나에 물을 줍니다.',
  '+10 BATCH CAPACITY EACH.': '한 대마다 동시 조리량 +10', 'THREE QUEUED RECIPES.': '요리 3개까지 대기 가능',
  'LMB COMMON · RMB CHOOSE DESTINATION': '좌클릭 로비 · 우클릭 목적지 선택',
  'RMB VIEW CHOSEN NUMBERS': '우클릭으로 선택한 번호 확인', 'RMB READ INFORMATION': '우클릭으로 정보 확인',
  'USE TO UNLOCK ONE NEW RECIPE.': '사용하면 새 레시피 하나를 배웁니다.',
  'USE: +12% MINING SPEED · 3M': '사용: 채광 속도 +12% · 3분', 'PAUSES DURING EVENTS': '미니게임 중에는 시간이 멈춥니다.',
  'USE ON GEAR: FORTUNE +1 LEVEL': '장비에 사용: 행운 +1단계', '20 MINES · 30 TREES · 32 CROPS': '광석 20회 · 나무 30회 · 작물 32회',
  'USE: CUTS ACTIVE COOK TIMES': '사용: 진행 중인 요리 시간 단축', 'UP TO 30S EACH · 90S TOTAL': '요리당 최대 30초 · 총 90초',
  'USE ON A FARM': '텃밭에서 사용', 'WATERS EVERY PLANTED CROP': '심은 작물에 모두 물을 줍니다.',
  '30% OFF ONE UPGRADE': '강화 1회 30% 할인', 'MAXIMUM DISCOUNT: 750K': '최대 할인 75만',
  'KEEPS YOUR LEVEL IF +4 FAILS': '+4 강화 실패 시 단계 유지',
  'KEEPS YOUR LEVEL IF +5 FAILS': '+5 강화 실패 시 단계 유지',
  'KEEPS YOUR LEVEL IF +6 FAILS': '+6 강화 실패 시 단계 유지',
  'ORCHARD JAM': '과일잼', 'APPLE BREAD': '사과빵', 'FARM SKEWER': '채소 꼬치',
  'GARDEN SALAD': '텃밭 샐러드', 'CITRUS MIX': '과일 모둠', 'MEADOW STEW': '채소 스튜',
  'ORCHARD PIE': '과일 파이', 'PUMPKIN BREAD': '호박빵', 'FARMHOUSE PLATE': '농장 한 접시',
  'MELON PRESERVE': '수박 절임', 'HARVEST FEAST': '수확 만찬', 'TRUFFLE BANQUET': '트러플 만찬',
  'CROPS WATER AUTOMATICALLY.': '농작물에 자동으로 물을 줍니다.',
  'CROPS AND FRUIT GROW 15% FASTER.': '농작물과 과일이 15% 빨리 자랍니다.',
  'COOKING FINISHES 10% FASTER.': '요리가 10% 빨리 끝납니다.',
  'SOFT VISIBILITY CHANGE.': '옅은 안개가 낍니다.',
  'USE A FARM FURNACE': '농장 화덕을 사용하세요', 'OWN A FARM FIRST': '먼저 텃밭을 구매하세요',
  'PICKAXE TIER TOO LOW': '더 좋은 곡괭이가 필요합니다', 'LUCK TONIC ALREADY ACTIVE': '행운 물약 사용 중',
  'MINING TONIC ALREADY ACTIVE': '채광 물약 사용 중', 'INVALID PLOT': '사용할 수 없는 텃밭',
  'STOCK CHANGED': '재고가 변경되었습니다', 'UNAVAILABLE': '구매할 수 없습니다',
  'TIER': '장비 단계 부족', 'INVALID': '대상을 찾을 수 없습니다', 'INVALID-ID': '대상을 찾을 수 없습니다',
  'USE PLOT': '텃밭 사용', 'HARVEST APPLES': '사과 수확', 'HARVEST ORANGES': '오렌지 수확',
  'GATHER TRUFFLE': '트러플 채집', 'INSPECT FOSSIL': '유물 확인', 'CLAIM FARM': '텃밭 구매',
  'CLAIMED': '주인 있음', 'MINE ORE': '광석 채광', 'SELECT SEEDS': '씨앗 선택', 'NEED SEEDS': '씨앗 부족',
  'SELECT WATERING CAN': '물뿌리개 선택', 'PLANTED': '심기 완료', 'PLANTED · WATERED': '심고 물주기 완료',
  'WATERED': '물주기 완료', 'NEED A FARM DEED': '텃밭 계약서 필요',
  'ALREADY OWNED': '이미 보유 중', 'PURCHASE PENDING': '구매 중', 'SHOP UNAVAILABLE': '상점을 이용할 수 없음',
  'CHOOSE 3 NUMBERS': '번호 3개 선택', 'GONE FOR NOW': '지금은 자리를 비웠습니다', 'ALREADY PURCHASED': '이미 구매함',
  'INFORMATION ADDED': '정보를 받았습니다', 'MERCHANT UNAVAILABLE': '상인을 이용할 수 없음', 'COULD NOT BUY': '구매 실패',
  'ITEM NOT OWNED': '보유하지 않은 아이템', 'PROTECTION UNAVAILABLE': '보호 아이템 없음',
  'DISCOUNT UNAVAILABLE': '할인 아이템 없음', 'USE AFTER THE EVENT': '이벤트 종료 후 사용 가능',
  'NOTHING COOKING': '조리 중인 요리 없음', 'CHOOSE YOUR FARM': '내 텃밭을 선택하세요', 'NO DRY CROPS': '물을 줄 작물 없음',
  'FARM WATERED': '텃밭 물주기 완료', 'RECIPE NOT LEARNED': '배우지 않은 레시피', 'TRADE CANCELLED': '거래 취소',
  'FARM ACTION FAILED': '텃밭 작업 실패', 'FRUIT STORAGE FULL': '과일 보관함 가득 참',
  'TRADE REQUEST SENT': '거래 요청을 보냈습니다', 'TRADE COULD NOT COMPLETE': '거래를 완료하지 못했습니다',
  'SELECT A PICKAXE': '곡괭이를 선택하세요', 'RETURNED HOME': '로비로 이동', 'FARM LIMIT REACHED': '텃밭은 3개까지 구매할 수 있습니다',
  'RETURN TO THE FARM': '농장으로 이동하세요',
  'PLOT OCCUPIED': '이미 심은 자리입니다', 'CANNOT WATER': '물을 줄 수 없습니다',
  'EVENT LEFT': '이벤트에서 나왔습니다', 'MISSING MATERIALS': '재료 부족',
  'A MARKET-WIDE RALLY LIFTS EVERY LISTED COMPANY.': '주식 시장 전반이 크게 상승합니다.',
  'A SUDDEN SELL-OFF CUTS VALUATIONS ACROSS THE EXCHANGE.': '주식 시장 전반이 크게 하락합니다.',
  'PHONE MAKERS SURGE WHILE CHIP FIRMS RETREAT.': '휴대폰 기업은 오르고 반도체 기업은 하락합니다.',
  'COMPUTING DEMAND SENDS CHIPMAKERS SHARPLY HIGHER.': '반도체 수요가 늘며 관련 주가가 크게 오릅니다.',
  'NEW HARVEST CONTRACTS RESET COMMODITY PRICES.': '채집물과 농작물 시세가 기준가로 돌아갑니다.',
  'A WORKSHOP SHORTAGE DRIVES ORE PRICES UPWARD.': '공방의 재료 부족으로 광석 가격이 크게 오릅니다.',
  'BROAD RALLY': '동반 상승', 'MARKET CRASH': '시장 폭락', 'MOBILE SPLIT': '휴대폰주 강세',
  'CHIP BOOM': '반도체 호황', 'HARVEST RESET': '시세 초기화', 'MATERIAL SHORTAGE': '광석 품귀',
  'EVERY STOCK WILL RISE ABOUT 50%.': '모든 주식이 약 50% 오릅니다.',
  'RAW-MATERIAL PRICES WILL ALSO RISE AS SUPPLY TIGHTENS.': '원자재 매입가도 함께 오릅니다.',
  'EVERY STOCK WILL LOSE ABOUT HALF ITS VALUE.': '모든 주식이 절반가량 하락합니다.',
  'CROP DEMAND WILL RISE WHILE INVESTORS LEAVE STOCKS.': '농작물 가격은 오르고 주식 시장은 약세가 됩니다.',
  'APPLE AND SAMSUNG WILL RISE SHARPLY.': 'Apple과 Samsung이 크게 오릅니다.',
  'NVIDIA AND AMD WILL DROP SHARPLY.': 'NVIDIA와 AMD가 크게 하락합니다.',
  'NVIDIA AND AMD WILL RISE SHARPLY.': 'NVIDIA와 AMD가 크게 오릅니다.',
  'FARM PRODUCE WILL RESET TO NORMAL MARKET LEVELS.': '농작물 매입가가 기준가로 돌아갑니다.',
  'ALL COMMODITY PRICES WILL RETURN TO THEIR STARTING LEVELS.': '모든 매입가가 기준가로 돌아갑니다.',
  'STOCK PRICES WILL SPLIT INSTEAD OF MOVING TOGETHER.': '주식은 종목별로 다르게 움직입니다.',
  'EVERY MINE MATERIAL WILL BECOME MUCH MORE VALUABLE.': '모든 광석 매입가가 크게 오릅니다.',
  'TECHNOLOGY STOCKS WILL WEAKEN DURING THE SHORTAGE.': '기술주는 하락합니다.',
}

const ITEM_KO: Partial<Record<ItemId, string>> = {
  'farm-deed': '개인 농장 계약서', 'shared-farm-deed': '추가 농장 계약서', 'lottery-ticket': '복권', 'information-note': '정보 쪽지',
  'cookbook-box': '레시피 상자', 'mining-boost': '채광 물약', 'fortune-boost': '행운 물약',
  'cook-timer': '요리 타이머', 'rain-bottle': '비구름 병', 'upgrade-coupon': '30% 할인',
  'upgrade-guard-4': '+4 하락 보호', 'upgrade-guard-5': '+5 하락 보호', 'upgrade-guard-6': '+6 하락 보호',
  furnace: '화덕', 'water-can': '물뿌리개', 'home-charm': '귀환 부적', 'harvest-charm': '수확 부적',
  'worn-pickaxe': '낡은 곡괭이', 'iron-pickaxe': '철 곡괭이', 'steel-pickaxe': '강철 곡괭이',
  'crystal-pickaxe': '수정 곡괭이', basket: '바구니', 'reinforced-basket': '채집 상자', 'master-basket': '과수원 수레',
  'wheat-seeds': '밀 씨앗', 'tomato-seeds': '토마토 씨앗', 'lettuce-seeds': '양상추 씨앗',
  'pumpkin-seeds': '호박 씨앗', 'watermelon-seeds': '수박 씨앗', wheat: '밀', tomato: '토마토',
  lettuce: '양상추', pumpkin: '호박', watermelon: '수박', berries: '베리', apple: '사과', orange: '오렌지',
  mushroom: '버섯', 'wild-herbs': '약초', wildflower: '들꽃', truffle: '희귀 트러플',
  'natural-discovery': '화석', 'copper-ore': '구리 원석', 'iron-ore': '철 원석',
  'silver-ore': '은 원석', 'gold-ore': '금 원석', 'crystal-ore': '수정 원석', 'ancient-ore': '고대 원석',
  'gold-coins': '코인',
  'food-berry-jam': '과일잼', 'food-apple-bread': '사과빵', 'food-mushroom-skewer': '채소 꼬치',
  'food-garden-salad': '텃밭 샐러드', 'food-citrus-mix': '과일 모둠', 'food-meadow-stew': '채소 스튜',
  'food-orchard-pie': '과일 파이', 'food-pumpkin-bread': '호박빵', 'food-farmhouse-plate': '농장 한 접시',
  'food-melon-preserve': '수박 절임', 'food-harvest-feast': '수확 만찬', 'food-truffle-banquet': '트러플 만찬',
}

const SHOP_KO: Record<ShopKind, string> = {
  common: '상점', forage: '채집 도구', 'forage-sell': '채집품 판매', farm: '농장 용품',
  produce: '농작물 판매', food: '요리 판매', mine: '채광 도구', ore: '광석 판매',
}

export function uiText(language: UiLanguage, value: string) {
  if (language !== 'ko' || !value) return value
  const direct = KO[value.trim().toUpperCase()]
  if (direct) return direct
  const exactItem = Object.entries(ITEMS).find(([, definition]) => definition.name.toUpperCase() === value.trim().toUpperCase())
  if (exactItem) return ITEM_KO[exactItem[0] as ItemId] ?? value
  const opensAt = value.match(/^Opens at (\d+)m$/i)
  if (opensAt) return `${opensAt[1]}분 후 공개`
  const needQuantity = value.match(/^Need (\d+) (.+)$/i)
  if (needQuantity) {
    const item = Object.entries(ITEMS).find(([, definition]) => definition.name.toUpperCase() === needQuantity[2].toUpperCase())
    return `${item ? ITEM_KO[item[0] as ItemId] ?? needQuantity[2] : KO[needQuantity[2].toUpperCase()] ?? needQuantity[2]} ${needQuantity[1]}개 필요`
  }
  const need = value.match(/^Need (.+)$/i)
  if (need) {
    const item = Object.entries(ITEMS).find(([, definition]) => definition.name.toUpperCase() === need[1].toUpperCase())
    return `${item ? ITEM_KO[item[0] as ItemId] ?? need[1] : KO[need[1].toUpperCase()] ?? need[1]} 필요`
  }
  const added = value.match(/^\+(\d+)\s+(.+?)(\s{2}\+\d+ Fortune)?(\s{2}\+Seed)?$/)
  if (added) {
    const item = Object.entries(ITEMS).find(([, definition]) => definition.name.toUpperCase() === added[2].toUpperCase())
    const fortune = added[3]?.match(/\+(\d+)/)?.[1]
    return `+${added[1]} ${item ? ITEM_KO[item[0] as ItemId] ?? added[2] : KO[added[2].toUpperCase()] ?? added[2]}${fortune ? ` · 추가 수확 +${fortune}` : ''}${added[4] ? ' · 씨앗 +1' : ''}`
  }
  const plant = value.match(/^Plant\s+(.+)$/i)
  if (plant) {
    const item = Object.entries(ITEMS).find(([id, definition]) => id === plant[1] || definition.name.toUpperCase() === plant[1].toUpperCase())
    return item ? `${ITEM_KO[item[0] as ItemId] ?? plant[1]} 심기` : '심기'
  }
  const unlockedRecipe = value.match(/^Unlocked\s+(.+)!$/i)
  if (unlockedRecipe) return `${KO[unlockedRecipe[1].toUpperCase()] ?? unlockedRecipe[1]} 레시피 습득!`
  const queuedRecipe = value.match(/^(.+) queued$/i)
  if (queuedRecipe) return `${KO[queuedRecipe[1].toUpperCase()] ?? queuedRecipe[1]} 조리 시작`
  const cookedRecipe = value.match(/^(.+) ×(\d+)$/i)
  if (cookedRecipe) return `${KO[cookedRecipe[1].toUpperCase()] ?? cookedRecipe[1]} ×${cookedRecipe[2]}`
  const farmClaimed = value.match(/^Farm\s+(\d+)\s+claimed$/i)
  if (farmClaimed) return `농장 ${farmClaimed[1]} 구매 완료`
  const ticket = value.match(/^Ticket\s+(.+)$/i)
  if (ticket) return `선택 번호 ${ticket[1]}`
  const draw = value.match(/^Draw\s+(.+?)(\s{2}\+.+)?$/i)
  if (draw) return `추첨 ${draw[1]}${draw[2] ?? ''}`
  const placementReward = value.match(/^(\d+)(?:st|nd|rd|th)\s+·\s+(.+)$/i)
  if (placementReward) return `${placementReward[1]}등 · ${placementReward[2]}`
  const round = value.match(/^Round\s+(\d+)$/i)
  if (round) return `${round[1]}라운드`
  const upgraded = value.match(/^Upgraded\s+·\s+(.+)\s+\+(\d+)$/i)
  if (upgraded) {
    const item = Object.entries(ITEMS).find(([, definition]) => definition.name.toUpperCase() === upgraded[1].toUpperCase())
    return `${item ? ITEM_KO[item[0] as ItemId] ?? upgraded[1] : upgraded[1]} +${upgraded[2]} 강화 성공`
  }
  const keptUpgrade = value.match(/^Upgrade failed\s+·\s+kept\s+\+(\d+)$/i)
  if (keptUpgrade) return `강화 실패 · +${keptUpgrade[1]} 유지`
  const droppedUpgrade = value.match(/^Upgrade failed\s+·\s+dropped to\s+\+(\d+)$/i)
  if (droppedUpgrade) return `강화 실패 · +${droppedUpgrade[1]}로 하락`
  const luckUses = value.match(/^Luck Tonic\s+·\s+(\d+) uses$/i)
  if (luckUses) return `행운 물약 · ${luckUses[1]}회`
  const cookTimer = value.match(/^Cook Timer\s+·\s+-(\d+)s$/i)
  if (cookTimer) return `요리 타이머 · -${cookTimer[1]}초`
  if (/^Mining Tonic\s+·\s+3:00$/i.test(value)) return '채광 물약 · 3:00'
  const seconds = value.match(/^(\d+)s remaining$/i)
  if (seconds) return `${seconds[1]}초 남음`
  const points = value.match(/^(\d+) PTS$/i)
  if (points) return `${points[1]}점`
  const farm = value.match(/^FARM (\d+)$/i)
  if (farm) return `농장 ${farm[1]}`
  const player = value.match(/^PLAYER\s+([\p{L}\p{N}_-]+)$/iu)
  if (player) return `플레이어 ${player[1]}`
  const cooking = value.match(/^(\d+)\/3 cooking$/i)
  if (cooking) return `${cooking[1]}/3 조리 중`
  const stores = value.match(/^Stores (\d+) fruit$/i)
  if (stores) return `과일 ${stores[1]}개 보관`
  const chance = value.match(/^(\d+)% chance: (\d+)× yield$/i)
  if (chance) return `${chance[1]}% · ${chance[2]}× 획득`
  const speed = value.match(/^\+?([\d.]+)% mining speed$/i)
  if (speed) return `채광 속도 +${speed[1]}%`
  const slot = value.match(/^Slot (\d+)$/i)
  if (slot) return `슬롯 ${slot[1]}`
  const protect = value.match(/^Protect \+(\d+)$/i)
  if (protect) return `+${protect[1]} 하락 보호`
  const owned = value.match(/^(\d+) owned$/i)
  if (owned) return owned[1] === '0' ? '미보유' : `${owned[1]}개 보유`
  const uses = value.match(/^(\d+) uses$/i)
  if (uses) return `${uses[1]}회`
  const average = value.match(/^([\d.]+)× average harvest$/i)
  if (average) return `평균 수확량 ${average[1]}배`
  const multiplierSpeed = value.match(/^([\d.]+)× mining speed$/i)
  if (multiplierSpeed) return `채광 속도 ${multiplierSpeed[1]}배`
  const remainingKorean = value.match(/^(\d+)s$/i)
  if (remainingKorean) return `${remainingKorean[1]}초`
  return value
}

export function itemName(language: UiLanguage, id: ItemId, fallback: string) {
  return language === 'ko' ? ITEM_KO[id] ?? fallback : fallback
}

export function shopName(language: UiLanguage, kind: ShopKind, fallback: string) {
  return language === 'ko' ? SHOP_KO[kind] : fallback
}

export function zoneName(language: UiLanguage, zone: ZoneId) {
  const english: Record<ZoneId, string> = { hub: 'COMMON', forage: 'FORAGE', farm: 'FARM', mine: 'MINE' }
  return uiText(language, english[zone])
}

export function toastText(language: UiLanguage, value: string) {
  if (language === 'ko') {
    if (value === 'Rain') return '비가 내림'
    if (value === 'Sunny') return '화창한 날씨'
    if (value === 'Mist') return '안개 낀 날씨'
    if (value === 'Breeze') return '산들바람'
    if (value === 'Clear') return '맑은 날씨'
  }
  return uiText(language, value)
}

export const localizedItemIds = ITEM_KO

type LocalizedNodeState = { source: string; target: string }
const localizedTextNodes = new WeakMap<Text, LocalizedNodeState>()
const localizedAttributes = new WeakMap<Element, Map<string, LocalizedNodeState>>()

function translateTextNode(node: Text, language: UiLanguage) {
  if (node.parentElement?.closest('[data-no-localize]')) return
  const current = node.data
  let state = localizedTextNodes.get(node)
  if (!state || current !== state.target) state = { source: current, target: current }
  const trimmed = state.source.trim()
  const translated = trimmed ? uiText(language, trimmed) : trimmed
  const target = trimmed && translated !== trimmed ? state.source.replace(trimmed, translated) : state.source
  localizedTextNodes.set(node, { source: state.source, target })
  if (current !== target) node.data = target
}

function translateAttribute(element: Element, attribute: string, language: UiLanguage) {
  if (element.closest('[data-no-localize]')) return
  const current = element.getAttribute(attribute)
  if (!current) return
  const states = localizedAttributes.get(element) ?? new Map<string, LocalizedNodeState>()
  let state = states.get(attribute)
  if (!state || current !== state.target) state = { source: current, target: current }
  const target = uiText(language, state.source)
  states.set(attribute, { source: state.source, target })
  localizedAttributes.set(element, states)
  if (current !== target) element.setAttribute(attribute, target)
}

/** Fallback coverage for existing presentational literals while core components use typed helpers directly. */
export function localizeDom(root: ParentNode, language: UiLanguage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) { translateTextNode(node as Text, language); node = walker.nextNode() }
  if (root instanceof Element) for (const attribute of ['aria-label', 'title', 'alt']) translateAttribute(root, attribute, language)
  root.querySelectorAll?.('[aria-label], [title], [alt]').forEach((element) => {
    for (const attribute of ['aria-label', 'title', 'alt']) translateAttribute(element, attribute, language)
  })
}
