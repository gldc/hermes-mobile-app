// jest.setup.ts — global mocks for component tests (React Native Testing Library).
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
