# Changelog

All notable changes to AgentifUI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-12-12

### Security

- **CRITICAL**: Fixed CVE-2025-55182 - React Server Components Remote Code Execution vulnerability (Critical Severity, CVSS 10.0)
- **CRITICAL**: Fixed CVE-2025-55184 & CVE-2025-67779 - Denial of Service vulnerabilities (High Severity, CVSS 7.5)
- **CRITICAL**: Fixed CVE-2025-55183 - Source Code Exposure vulnerability (Medium Severity, CVSS 5.3)
- Upgraded React from 19.1.1 to 19.1.4
- Upgraded Next.js from 15.4.7 to 15.4.10

### Added

- Enhanced think block parsing for multiple and nested blocks (#305)
- Complete admin content image upload system (#288, #286, #283)
  - Image upload service and custom hook (#283)
  - Image upload dialog component (#286)
  - Editor integration (#288)
  - Auto-cleanup for unused content images (#289)
- Content-images storage bucket for admin editor (#278)
- Configurable email domain for SSO providers (#274)
- Comprehensive document preview system with i18n support (#194)
- Search functionality in application instances list (#192)
- English fallback for missing translation keys (#186)
- Version display in about menu (#201)
- Optimized CI workflows and i18n translation system (#204)
- MCP server configuration with environment variables (#202)
- Enhanced Claude AI agent reviewer capabilities

### Fixed

- Dify retriever resource extraction from metadata (#287)
- Image upload race condition and premature cleanup (#291)
- Image alignment property in content editor (#282)
- Image width/height input handling in context menu (#277)
- UUID generation function migration from uuid_generate_v4() to gen_random_uuid() (#271)
- Invalid Beijing timezone and validation feedback (#260)
- Confirm dialog blocking background modal interactions (#259)
- Start Exploring button navigation URL in all languages (#246)
- Provider management modal UI and functionality (#217)
- Hardcoded text replacement with i18n in file preview (#207)
- Color mapping in sidebar and chat-input components (#233)
- Sidebar highlight mutex behavior consistency (#198)
- Sidebar highlight delay when switching conversations (#190)
- CI PR creation authentication issues (#206)
- Lint issues with safe unused variable and import removal (#200)

### Changed

- **Major**: Migrated entire codebase from isDark conditional logic to Tailwind dark: prefix
  - 250+ conversions across 20+ pull requests
  - Improved code consistency and maintainability
  - Better Tailwind CSS best practices adoption
- Rebuilt content editor with drag-and-drop component system (#209)
- Centralized auth error handling with enhanced security validation (#280)
- Aligned Claude agents with AgentifUI project requirements (#191)
- Eliminated explicit any types in Dify services (#211)
- Improved desktop user avatar component with Tailwind best practices (#216)

### Removed

- Deprecated stagewise toolbar integration (#189)
- Docker deployment section from documentation (#188)
- Unused files and cleaned up PM2 scripts (#183)

### Chores

- Updated Jest to latest version (#306)
- Added Speckit framework configuration (#294)
- Locked pnpm version to 10.14.0 (#212)
- Updated favicon (#219)
- Added ccusage statusline in Claude Code (#210)
- Moved .claude/settings.json to example file (#270)
- Restructured and cleaned up documentation (#187)
- Auto-updated translations (#297, #285, #242, #218, #208)

## [0.1.0] - 2025-07-31

### Added

#### Core Platform Features

- **Enterprise-Grade Chat Interface**: Responsive chat UI supporting desktop and mobile devices
- **Multi-Application Support**: Support for chatbot, workflow, text-generation, and agent application types
- **Real-time Message Streaming**: Dify API integration with streaming responses and auto-scroll
- **Conversation Management**: Message persistence with resume-from-breakpoint capability
- **Message Actions**: Copy, edit, regenerate, and feedback functionality for chat messages

#### Authentication & Security

- **Supabase Authentication**: Complete user authentication system with SSO support
- **Row-Level Security (RLS)**: Database-level security policies for data isolation
- **Encrypted API Key Storage**: Secure storage and management of API keys with encryption
- **Role-Based Access Control**: Admin and user role management with permission controls
- **Multi-Provider SSO**: Support for various SSO providers including SAML and OAuth

#### User Management & Organizations

- **User Profile Management**: Comprehensive user profile system with avatar support
- **Group Management**: Department/group-based user organization and permissions
- **Admin Dashboard**: Complete administrative interface for user and system management
- **User Permissions**: Granular permission control for applications and features

#### Internationalization & Accessibility

- **Multi-Language Support**: Full i18n support for 10 languages (zh-CN, en-US, es-ES, zh-TW, ja-JP, de-DE, fr-FR, it-IT, pt-PT, ru-RU)
- **Theme System**: Light/dark theme support with system preference detection
- **Accessibility Features**: WCAG-compliant components with keyboard navigation and screen readers
- **Responsive Design**: Mobile-first responsive design with touch-friendly interfaces

#### Technical Infrastructure

- **Next.js 15 App Router**: Modern React 19 application with App Router architecture
- **TypeScript Coverage**: Full TypeScript implementation with strict type checking
- **Supabase Integration**: Complete backend-as-a-service integration (Auth + DB + Storage)
- **State Management**: Zustand-based state management with persistence
- **Real-time Updates**: Supabase real-time subscriptions for live data synchronization

#### Development & Quality Tools

- **Code Quality**: ESLint, Prettier, and TypeScript configurations
- **Testing Framework**: Jest testing setup with coverage reporting
- **Git Hooks**: Husky and lint-staged for automated code quality checks
- **I18n Validation**: Custom scripts for translation consistency checking
- **Build Optimization**: Production-ready build configurations with bundle analysis

#### API & Integration Features

- **Dify API Integration**: Complete integration with Dify services for LLM capabilities
- **RESTful API**: Well-designed API endpoints for frontend-backend communication
- **File Upload Support**: File attachment and preview capabilities
- **Caching System**: Intelligent caching for improved performance
- **Error Handling**: Comprehensive error handling with user-friendly messages

### Technical Details

#### Architecture

- **3-Tier Architecture**: Clean separation of presentation, business logic, and data layers
- **Service Layer Pattern**: Organized service classes for API integrations and business logic
- **Custom Hooks**: Reusable React hooks for state management and side effects
- **Component Library**: Modular UI components built with Radix UI primitives

#### Database Design

- **PostgreSQL**: Robust relational database with advanced features
- **Migration System**: Version-controlled database schema migrations
- **Performance Optimization**: Proper indexing and query optimization
- **Data Integrity**: Foreign key constraints and validation rules

#### Security Features

- **API Key Encryption**: Industry-standard encryption for sensitive data storage
- **CORS Configuration**: Proper cross-origin resource sharing setup
- **Input Validation**: Comprehensive input validation and sanitization
- **Authentication Flows**: Secure authentication with JWT token management

### Performance & Optimization

- **Bundle Optimization**: Code splitting and lazy loading implementation
- **Image Optimization**: Next.js Image component with optimization
- **Caching Strategy**: Multi-level caching for improved performance
- **Memory Management**: Efficient state management and memory usage

### Developer Experience

- **Development Tools**: Comprehensive development toolchain setup
- **Documentation**: Detailed documentation for setup, deployment, and architecture
- **Code Standards**: Consistent code style and quality standards
- **CI/CD Ready**: Prepared for continuous integration and deployment

[0.2.0]: https://github.com/iflabx/agentifui/releases/tag/v0.2.0
[0.1.0]: https://github.com/iflabx/agentifui/releases/tag/v0.1.0
