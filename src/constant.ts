import type { ConnectorMetadata } from '@logto/connector-kit';
import { ConnectorConfigFormItemType, ConnectorPlatform } from '@logto/connector-kit';

/**
 * Logto connector factory id.
 *
 * Kept identical to the upstream `@workingbit/connector-vk` factory id so that an installation
 * can be migrated in place without touching the `connectorId` stored in the Logto database.
 * Logto rejects duplicate factory ids, therefore this package and the upstream package must never
 * be installed side by side.
 */
export const connectorId = 'vk-universal';

/** Logto social connector target. One social identity per target is allowed per user. */
export const connectorTarget = 'vk';

/**
 * Canonical VK ID API origin.
 *
 * `https://id.vk.ru` is the API host used by every official VK ID document and hardcoded in the
 * official `vkid-web-sdk`. `https://id.vk.com` is not a separate API host: it answers with an
 * HTTP 308 redirect to `id.vk.ru`, so it can be configured but adds a redirect to every call.
 */
export const defaultApiBaseUrl = 'https://id.vk.ru';

/** VK ID authorization endpoint path, appended to the API origin. */
export const authorizationPath = '/authorize';

/** VK ID token endpoint path, appended to the API origin. */
export const tokenPath = '/oauth2/auth';

/** VK ID user info endpoint path, appended to the API origin. */
export const userInfoPath = '/oauth2/user_info';

/** Only permission required to read the VK ID profile. */
export const defaultScope = 'vkid.personal_info';

/** Network timeout for VK ID endpoints. */
export const defaultTimeout = 8000;

export const metadata: ConnectorMetadata = {
  id: connectorId,
  target: connectorTarget,
  platform: ConnectorPlatform.Universal,
  // Logto localises `name` and `description` via the I18nPhrases contract (en required). Form-item
  // labels and the readme are plain strings in @logto/connector-kit 5.2.0, so those are bilingual
  // in one string ("English / Русский") and the readme contains both languages.
  name: {
    en: 'VK OAuth 2.1',
    'ru-RU': 'VK OAuth 2.1',
  },
  description: {
    en: 'Sign in with VK OAuth 2.1 (authorization code flow with PKCE)',
    'ru-RU': 'Вход через VK OAuth 2.1 (authorization code + PKCE)',
  },
  logo: './logo.png',
  logoDark: './logo-dark.png',
  readme: './CONNECTOR.md',
  isTokenStorageSupported: true,
  formItems: [
    {
      key: 'clientId',
      type: ConnectorConfigFormItemType.Text,
      label: 'Client ID / Идентификатор приложения',
      required: true,
      placeholder: '<VK ID application id / ID приложения>',
      description:
        'Numeric application id from the VK ID cabinet. / Числовой ID приложения из кабинета VK ID.',
    },
    {
      key: 'serviceToken',
      type: ConnectorConfigFormItemType.Text,
      label: 'Service token / Сервисный ключ доступа',
      required: false,
      isConfidential: true,
      placeholder: '<VK ID service token / сервисный ключ>',
      description:
        'Confidential VK ID applications only; sent as service_token and requires an allow-listed IP. ' +
        'Leave empty for a public web application. / Только для конфиденциальных приложений: передаётся ' +
        'как service_token и требует разрешённого IP. Для публичного веб-приложения оставьте пустым.',
    },
    {
      key: 'scope',
      type: ConnectorConfigFormItemType.MultilineText,
      label: 'Scope / Права доступа',
      required: false,
      placeholder: defaultScope,
      description:
        'Space-separated VK ID scopes, default vkid.personal_info (id, name, avatar). ' +
        'Add email only if the VK application allows it and "Sync e-mail" is on. / ' +
        'Права через пробел, по умолчанию vkid.personal_info (id, имя, аватар). Добавляйте email, ' +
        'только если он разрешён приложению и включена синхронизация e-mail.',
    },
    {
      key: 'syncEmail',
      type: ConnectorConfigFormItemType.Switch,
      label: 'Sync e-mail / Синхронизировать e-mail',
      required: false,
      defaultValue: false,
      description:
        'Pass the VK e-mail to Logto. Enabling it lets Logto link an existing account by e-mail, ' +
        'so enable it only if you trust the VK e-mail. / Передавать e-mail из VK в Logto. Включайте, ' +
        'только если доверяете e-mail VK: Logto может связать по нему существующий аккаунт.',
    },
    {
      key: 'syncPhone',
      type: ConnectorConfigFormItemType.Switch,
      label: 'Sync phone number / Синхронизировать телефон',
      required: false,
      defaultValue: false,
      description:
        'Pass the VK phone number to Logto (normalised to E.164). Logto prefers a phone match over ' +
        'an e-mail match when linking. / Передавать телефон VK в Logto (в формате E.164). При ' +
        'связывании аккаунтов Logto предпочитает телефон, а не e-mail.',
    },
    {
      key: 'apiBaseUrl',
      type: ConnectorConfigFormItemType.Text,
      label: 'VK ID API origin / Origin API VK ID (advanced)',
      required: false,
      placeholder: defaultApiBaseUrl,
      description:
        'Override the VK ID API origin; leave empty in production. An explicit http origin is ' +
        'accepted for LAN mirrors and tests but sends tokens unencrypted. / Переопределение origin ' +
        'API VK ID; в продакшене оставьте пустым. Явный http-origin допустим для LAN-зеркал и ' +
        'тестов, но передаёт токены без шифрования.',
    },
    {
      key: 'timeout',
      type: ConnectorConfigFormItemType.Number,
      label: 'Request timeout, ms / Таймаут запроса, мс',
      required: false,
      defaultValue: defaultTimeout,
      description: 'Token and user_info request timeout. / Таймаут запросов token и user_info.',
    },
  ],
};
