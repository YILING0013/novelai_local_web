"use client";

import React from 'react';
import Img2ImgPanel from './ImageParameterPanelUI/Img2ImgPanel';
import VibePanel from './ImageParameterPanelUI/VibePanel';
import CharacterControlPanel from './ImageParameterPanelUI/CharacterControlPanel';

const ImageParameterPanel = ({
    params,
    handleParamChange,
    handleSeedChange,
    editing,
    tempInputs,
    handleInputFocus,
    handleInputChange,
    handleInputBlur,
    handleSizePresetClick,
    handleClearSeed,
    handleRefreshSeed,
    handleSmeaChange,
    handleDynChange,
    handleResetParamsConfirm,
    expandedPanels,
    onExpandedPanelsChange,
    fileInputRef,
    vibeFileInputRef,
    vibeImages,
    setVibeImages,
    imagePreview,
    handleImageUpload,
    handleImageDelete,
    handleOpenEditor,
    isDragging,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    isVibeDragging,
    handleVibeDragOver,
    handleVibeDragEnter,
    handleVibeDragLeave,
    handleVibeDrop,
    handleVibeImageUpload,
    handleVibeImageDelete,
    handleVibeInfoChange,
    handleVibeStrengthChange,
    handleVibeConvert,
    handleVibeV4FileUpload,
    onDownloadVibe,
    onDownloadBundle,
    onDownloadZip,
    onReferenceImageChange,
    characterTabs,
    handleCharacterDataChange,
    handleOpenCharacterEditor,
    handleAddCharacterTab,
    handleDeleteCharacterTab,
    handleMoveUpCharacterTab,
    handleMoveDownCharacterTab,
    renderEditSummary,
    editorKey,
    editorOpen,
    handleCloseEditor,
    directorToolParams,
    handleVibeToggleDisabled,
    handleCharacterToggleDisabled,
    // 接收禁用状态
    vibeDisabled,
    imageReferenceDisabled,
    isV5Model = false,
}) => {
  return (
    <>
      <Img2ImgPanel
        params={params}
        handleParamChange={handleParamChange}
        expandedPanels={expandedPanels}
        onExpandedPanelsChange={onExpandedPanelsChange}
        fileInputRef={fileInputRef}
        imagePreview={imagePreview}
        handleImageUpload={handleImageUpload}
        handleImageDelete={handleImageDelete}
        handleOpenEditor={handleOpenEditor}
        isDragging={isDragging}
        handleDragOver={handleDragOver}
        handleDragEnter={handleDragEnter}
        handleDragLeave={handleDragLeave}
        handleDrop={handleDrop}
        renderEditSummary={renderEditSummary}
        editorKey={editorKey}
        editorOpen={editorOpen}
        handleCloseEditor={handleCloseEditor}
        directorToolParams={directorToolParams}
      />

      {!isV5Model && (
        <VibePanel
          params={params}
          expandedPanels={expandedPanels}
          onExpandedPanelsChange={onExpandedPanelsChange}
          vibeFileInputRef={vibeFileInputRef}
          isVibeDragging={isVibeDragging}
          handleVibeDragOver={handleVibeDragOver}
          handleVibeDragEnter={handleVibeDragEnter}
          handleVibeDragLeave={handleVibeDragLeave}
          handleVibeDrop={handleVibeDrop}
          handleVibeV4FileUpload={handleVibeV4FileUpload}
          handleVibeImageUpload={handleVibeImageUpload}
          vibeImages={vibeImages}
          handleVibeImageDelete={handleVibeImageDelete}
          handleVibeInfoChange={handleVibeInfoChange}
          handleVibeStrengthChange={handleVibeStrengthChange}
          handleVibeConvert={handleVibeConvert}
          onDownloadVibe={onDownloadVibe}
          onDownloadBundle={onDownloadBundle}
          onDownloadZip={onDownloadZip}
          blocked={vibeDisabled}
          handleVibeToggleDisabled={handleVibeToggleDisabled}
        />
      )}

      <CharacterControlPanel
        params={params}
        handleParamChange={handleParamChange}
        expandedPanels={expandedPanels}
        onExpandedPanelsChange={onExpandedPanelsChange}
        characterTabs={characterTabs}
        handleAddCharacterTab={handleAddCharacterTab}
        handleDeleteCharacterTab={handleDeleteCharacterTab}
        handleMoveUpCharacterTab={handleMoveUpCharacterTab}
        handleMoveDownCharacterTab={handleMoveDownCharacterTab}
        handleCharacterDataChange={handleCharacterDataChange}
        handleOpenCharacterEditor={handleOpenCharacterEditor}
        handleCharacterToggleDisabled={handleCharacterToggleDisabled}
        isV5Model={isV5Model}
      />
    </>
  );
};

export default ImageParameterPanel;
