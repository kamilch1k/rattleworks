import { platformService } from './PlatformService';

const TERMS: Record<string, string> = {
  'RATTLEWORKS': 'RATTLEWORKS',
  '3D PHYSICS DESTRUCTION': '3D ФИЗИЧЕСКОЕ РАЗРУШЕНИЕ',
  'Aim. Launch. Drag the wreckage.': 'ЦЕЛЬТЕСЬ. ЗАПУСКАЙТЕ. ТАЩИТЕ ОБЛОМКИ.',
  'PLAY LEVELS': 'ИГРАТЬ В УРОВНИ',
  'Launch shots. Topple targets.': 'Запускайте снаряды. Роняйте цели.',
  'Experimental build lab': 'Экспериментальная лаборатория',
  'WIP': 'В РАЗРАБОТКЕ',
  'Click a world point to launch': 'Нажмите точку мира для запуска',
  'Then drag anything': 'Затем тащите всё',
  'Local': 'Локально',
  'OPENING THE TOY CRATE': 'ОТКРЫВАЕМ ЯЩИК ИГРУШЕК',
  'RATTLEWORKS LAB': 'ЛАБОРАТОРИЯ RATTLEWORKS',
  'CAMPAIGN': 'КАМПАНИЯ',
  'SANDBOX': 'ПЕСОЧНИЦА',
  'CAMPAIGN BUILD': 'СБОРКА КАМПАНИИ',
  'MAIN MENU': 'ГЛАВНОЕ МЕНЮ',
  'LEVELS': 'УРОВНИ',
  'BACK': 'НАЗАД',
  'PLAY': 'ИГРАТЬ',
  'CONTINUE': 'ПРОДОЛЖИТЬ',
  'START': 'СТАРТ',
  'RESET': 'СБРОСИТЬ',
  'RETRY': 'ЗАНОВО',
  'RETRY NOW ↺': 'ЗАНОВО ↺',
  'NEXT LEVEL →': 'СЛЕДУЮЩИЙ УРОВЕНЬ →',
  'CAMPAIGN COMPLETE →': 'КАМПАНИЯ ЗАВЕРШЕНА →',
  'PAUSED': 'ПАУЗА',
  'RESUME ▶': 'ПРОДОЛЖИТЬ ▶',
  'MENU': 'МЕНЮ',
  'QUALITY': 'КАЧЕСТВО',
  'Fastest': 'Быстро',
  'Balanced': 'Баланс',
  'Best shadows': 'Лучшие тени',
  'MASTER VOLUME': 'ОБЩАЯ ГРОМКОСТЬ',
  'CAMERA SHAKE': 'ТРЯСКА КАМЕРЫ',
  'SETTINGS': 'НАСТРОЙКИ',
  'RATTLEWORKS OPTIONS': 'НАСТРОЙКИ RATTLEWORKS',
  'POWER': 'СИЛА',
  'TIME': 'ВРЕМЯ',
  'TARGETS': 'ЦЕЛИ',
  'BODIES': 'ТЕЛА',
  'BODY': 'ТЕЛО',
  'ACTIVE': 'АКТИВНЫЕ',
  'SLEEP': 'СПЯЩИЕ',
  'ITEMS': 'ПРЕДМЕТЫ',
  'ITEMS USED': 'ПРЕДМЕТЫ ИСПОЛЬЗОВАНЫ',
  'DESTRUCTION': 'РАЗРУШЕНИЕ',
  'SCORE': 'СЧЁТ',
  'STARS': 'ЗВЁЗДЫ',
  'GRAB': 'ХВАТАТЬ',
  'SELECTED': 'ВЫБРАНО',
  'READY': 'ГОТОВО',
  'FIRE': 'ОГОНЬ',
  'LAUNCH': 'ЗАПУСК',
  'DROP': 'БРОСИТЬ',
  'FIRE HERE': 'СТРЕЛЯТЬ СЮДА',
  'LAUNCH HERE': 'ЗАПУСТИТЬ СЮДА',
  'CLICK TO LAUNCH HERE': 'НАЖМИТЕ ТОЧКУ ДЛЯ ЗАПУСКА',
  'CLICK TO FIRE HERE': 'НАЖМИТЕ ТОЧКУ ДЛЯ ОГНЯ',
  'CLICK TO USE WEAPON': 'НАЖМИТЕ ТОЧКУ ДЛЯ ОРУЖИЯ',
  'CLICK A WORLD POINT TO LAUNCH': 'НАЖМИТЕ ТОЧКУ МИРА ДЛЯ ЗАПУСКА',
  'CLICK A WORLD POINT TO FIRE': 'НАЖМИТЕ ТОЧКУ МИРА ДЛЯ ОГНЯ',
  'CLICK A WORLD POINT TO USE': 'НАЖМИТЕ ТОЧКУ МИРА ДЛЯ ИСПОЛЬЗОВАНИЯ',
  'WORK IN PROGRESS': 'В РАЗРАБОТКЕ',
  'EXPERIMENTAL MODE': 'ЭКСПЕРИМЕНТАЛЬНЫЙ РЕЖИМ',
  'SANDBOX LAB': 'ЛАБОРАТОРИЯ ПЕСОЧНИЦЫ',
  'ITEM SHOP': 'МАГАЗИН ПРЕДМЕТОВ',
  'EXPERIMENTAL STOCK': 'ЭКСПЕРИМЕНТАЛЬНЫЙ СКЛАД',
  'FAVORITES': 'ИЗБРАННОЕ',
  'RECENT': 'НЕДАВНИЕ',
  'SEARCH THE SHELVES...': 'ПОИСК ПО ПОЛКАМ...',
  'SELECT AN ITEM': 'ВЫБЕРИТЕ ПРЕДМЕТ',
  'THE SHELF IS READY': 'ПОЛКА ГОТОВА',
  'SPAWN / DROP': 'СОЗДАТЬ / БРОСИТЬ',
  'AT CAMERA TARGET': 'В ТОЧКЕ КАМЕРЫ',
  'NO FAVORITES YET': 'ИЗБРАННОГО НЕТ',
  'NOTHING DROPPED YET': 'ЕЩЁ НИЧЕГО НЕ БРОШЕНО',
  'NO MATCHES': 'НЕТ СОВПАДЕНИЙ',
  'PAUSE': 'ПАУЗА',
  'UNDO': 'ОТМЕНИТЬ',
  'REDO': 'ПОВТОРИТЬ',
  'SAVE': 'СОХРАНИТЬ',
  'LOAD': 'ЗАГРУЗИТЬ',
  'BLUEPRINT': 'ЧЕРТЁЖ',
  'CLEAR': 'ОЧИСТИТЬ',
  'DELETE': 'УДАЛИТЬ',
  'FREEZE': 'ЗАМОРОЗИТЬ',
  'ROTATE': 'ВРАЩАТЬ',
  'PUSH': 'ТОЛКАТЬ',
  'EXPLOSION': 'ВЗРЫВ',
  'CONNECT': 'СОЕДИНИТЬ',
  'ROPE': 'ВЕРЁВКА',
  'SPRING': 'ПРУЖИНА',
  'HINGE': 'ПЕТЛЯ',
  'MOTOR': 'МОТОР',
  'DUPLICATE': 'ДУБЛИРОВАТЬ',
  'LEFT DRAG · GRAB BODY PARTS': 'ЛЕВАЯ КНОПКА · ХВАТАТЬ ЧАСТИ ТЕЛА',
  'RIGHT DRAG · ORBIT': 'ПРАВАЯ КНОПКА · ВРАЩАТЬ КАМЕРУ',
  'MIDDLE / SHIFT DRAG · PAN': 'СРЕДНЯЯ / SHIFT · ПЕРЕМЕЩАТЬ КАМЕРУ',
  'WHEEL / PINCH · ZOOM': 'КОЛЕСО / ЩИПОК · МАСШТАБ',
  'WASD · MOVE FOCUS': 'WASD · ДВИГАТЬ ФОКУС',
  'F · FIRE OR PLACE': 'F · СТРЕЛЯТЬ ИЛИ РАЗМЕЩАТЬ',
  'SPACE · PAUSE': 'ПРОБЕЛ · ПАУЗА',
  'F3 · LAB STATS': 'F3 · СТАТИСТИКА',
  'Heavy Ball': 'Тяжёлый шар',
  'Metal Ball': 'Металлический шар',
  'Concrete Chunk': 'Кусок бетона',
  'Tank Shell': 'Танковый снаряд',
  'Pistol Shot': 'Пистолет',
  'Shotgun Blast': 'Дробовик',
  'Rifle Round': 'Винтовка',
  'Toy Bomb': 'Игрушечная бомба',
  'Thrown Bomb': 'Брошенная бомба',
  'Rocket': 'Ракета',
  'Utility Knife': 'Нож',
  'Block Machete': 'Мачете',
  'Fire Axe': 'Пожарный топор',
  'Yard Spear': 'Копьё',
  'Knock Knock': 'Тук-тук',
  'Bad Foundation': 'Плохой фундамент',
  'Barrel Trouble': 'Бочковая проблема',
  'Domino House': 'Домино-дом',
  'Spring Cleaning': 'Весенняя уборка',
  'Wrecking Ball': 'Шар разрушения',
  'Delivery Problem': 'Проблема доставки',
  'Bridge Disaster': 'Авария на мосту',
  'Castle Crash': 'Крушение замка',
  'Factory Accident': 'Авария на фабрике',
  'Tower Trouble': 'Башенная проблема',
  'EVERYTHING MUST GO': 'УНИЧТОЖИТЬ ВСЁ',
};

function translateValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  let translated = TERMS[trimmed] ?? trimmed;
  let match = /^LEVEL (\d+) COMPLETE$/.exec(trimmed);
  if (match) translated = `УРОВЕНЬ ${match[1]} ЗАВЕРШЁН`;
  match = /^LEVEL (\d+)$/.exec(trimmed);
  if (match) translated = `УРОВЕНЬ ${match[1]}`;
  match = /^COMPLETE LEVEL (\d+) TO UNLOCK$/.exec(trimmed);
  if (match) translated = `ЗАВЕРШИТЕ УРОВЕНЬ ${match[1]}`;
  match = /^FINISH LEVEL (\d+)$/.exec(trimmed);
  if (match) translated = `ЗАВЕРШИТЕ УРОВЕНЬ ${match[1]}`;
  match = /^USE NO MORE THAN (\d+) (?:HEAVY BALLS?|ITEMS?|PIECES?)$/.exec(trimmed);
  if (match) translated = `ИСПОЛЬЗУЙТЕ НЕ БОЛЕЕ ${match[1]} ПРЕДМ.`;
  match = /^FINISH IN (\d+) SECONDS$/.exec(trimmed);
  if (match) translated = `ЗАВЕРШИТЕ ЗА ${match[1]} СЕК.`;
  match = /^\+(\d+) PROP DAMAGE · (.+)$/.exec(trimmed);
  if (match) translated = `+${match[1]} УРОНА ПРЕДМЕТУ · ${TERMS[match[2]] ?? match[2]}`;
  match = /^\+(\d+) DAMAGE · (.+)$/.exec(trimmed);
  if (match) translated = `+${match[1]} УРОНА · ${TERMS[match[2]] ?? match[2]}`;
  match = /^(\d+) KILLS? · (.+)$/.exec(trimmed);
  if (match) translated = `${match[1]} УБИЙСТВ · ${TERMS[match[2]] ?? match[2]}`;
  match = /^(\d+) \/ (\d+) STARS$/.exec(trimmed);
  if (match) translated = `${match[1]} / ${match[2]} ЗВЁЗД`;
  match = /^([A-Z ]+) · (.+)$/.exec(trimmed);
  if (match && TERMS[match[1]]) translated = `${TERMS[match[1]]} · ${TERMS[match[2]] ?? match[2]}`;

  if (translated === trimmed && trimmed === 'Local') translated = 'Локально';
  if (translated === trimmed && trimmed === 'CrazyGames') translated = 'CrazyGames';
  if (translated === trimmed && trimmed === 'Yandex Games') translated = 'Яндекс Игры';
  if (translated === trimmed) return value;
  return value.replace(trimmed, translated);
}

function translateTree(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) textNodes.push(current as Text);
  for (const node of textNodes) {
    const value = node.nodeValue ?? '';
    const translated = translateValue(value);
    if (translated !== value) node.nodeValue = translated;
  }

  root.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of ['aria-label', 'title', 'placeholder']) {
      const value = element.getAttribute(attribute);
      if (value) {
        const translated = translateValue(value);
        if (translated !== value) element.setAttribute(attribute, translated);
      }
    }
  });
}

export interface LocaleController {
  setLanguage(language?: string): void;
  dispose(): void;
}

/** Activates Russian only for the Yandex build/host. CrazyGames stays English. */
export function installRussianLocale(root: HTMLElement): LocaleController {
  const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const russian = platformService.kind === 'yandex' || query?.get('lang') === 'ru' || query?.get('locale') === 'ru';
  if (!russian) return { setLanguage: () => undefined, dispose: () => undefined };

  document.documentElement.lang = 'ru';
  let applying = false;
  let queued = false;
  const apply = (): void => {
    if (applying) return;
    applying = true;
    translateTree(root);
    applying = false;
  };
  const observer = new MutationObserver(() => {
    if (applying || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      apply();
    });
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
  apply();
  return {
    setLanguage: (language?: string): void => {
      const detected = (language ?? 'ru').toLowerCase().split('-')[0] || 'ru';
      // Russian is the declared Yandex localization. Unsupported portal
      // languages intentionally fall back to it, while still recording the
      // SDK-detected code for the platform's i18n check.
      document.documentElement.dataset.i18nLanguage = detected;
      document.documentElement.lang = 'ru';
      apply();
    },
    dispose: () => observer.disconnect(),
  };
}
