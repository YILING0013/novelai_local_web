// MetadataDialog.js
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Paper,
  Divider,
  Chip,
  Switch,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  IconButton
} from '@mui/material';
import { 
  InfoOutlined, 
  ExpandMore as ExpandMoreIcon, 
  Person as PersonIcon,
  Place as PlaceIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon
} from '@mui/icons-material';
import { useI18n } from '@/i18n/I18nProvider';

const MetadataDialog = ({ open, onClose, metadata, onApply }) => {
  const { t } = useI18n();
  // 为每个参数单独创建控制状态
  const [paramStatus, setParamStatus] = useState({});
  
  // 当metadata改变时初始化参数状态
  useEffect(() => {
    if (metadata) {
      const initialStatus = {};
      
      // 基础参数
      if (metadata.width) initialStatus.width = true;
      if (metadata.height) initialStatus.height = true;
      if (metadata.steps) initialStatus.steps = true;
      if (metadata.guidanceScale) initialStatus.guidanceScale = true;
      if (metadata.seed !== undefined) initialStatus.seed = true;
      if (metadata.sampler) initialStatus.sampler = true;
      if (metadata.noiseSchedule) initialStatus.noiseSchedule = true;
      
      // 高级参数
      if (metadata.smea !== undefined) initialStatus.smea = true;
      if (metadata.dyn !== undefined) initialStatus.dyn = true;
      if (metadata.promptGuidanceRescale !== undefined) initialStatus.promptGuidanceRescale = true;
      
      // 提示词
      if (metadata.positivePrompt) initialStatus.positivePrompt = true;
      if (metadata.negativePrompt) initialStatus.negativePrompt = true;
      
      // 角色信息
      if (metadata.characterTabs) {
        initialStatus.characterTabs = true;
        metadata.characterTabs.forEach((_, index) => {
          initialStatus[`character_${index}`] = true;
        });
      }
      
      setParamStatus(initialStatus);
    }
  }, [metadata]);

  if (!metadata) return null;
  
  const renderPrompt = (text, maxLength = 100) => {
    if (!text) return t('painting.tools.metadata.none');
    return text.length > maxLength 
      ? text.substring(0, maxLength) + '...' 
      : text;
  };
  
  const getModelName = (sampler) => {
    if (!sampler) return t('painting.tools.metadata.unknown');
    // 将采样器名称映射为人类可读的模型名称
    const modelMap = {
      'k_euler_ancestral': 'Euler Ancestral',
      'k_euler': 'Euler',
      'k_dpmpp_2s_ancestral': 'DPM++ 2S Ancestral',
      'k_dpmpp_2m': 'DPM++ 2M',
      'k_dpmpp_sde': 'DPM++ SDE',
      'ddim_v3': 'DDIM'
      // 根据需要添加其他映射
    };
    return modelMap[sampler] || sampler;
  };
  
  // 切换单个参数的状态
  const toggleParam = (param) => {
    setParamStatus(prev => ({
      ...prev,
      [param]: !prev[param]
    }));
  };
  
  // 切换全选/全不选
  const toggleSelectAll = () => {
    // 检查当前是否所有参数都被选中
    const isAllSelected = Object.values(paramStatus).every(value => value);
    
    // 创建新状态对象，所有参数设置为相反状态
    const newStatus = {};
    Object.keys(paramStatus).forEach(key => {
      newStatus[key] = !isAllSelected;
    });
    
    setParamStatus(newStatus);
  };
  
  // 获取是否所有参数都被选中
  const isAllSelected = Object.values(paramStatus).every(value => value);
  
  // 自定义应用按钮处理函数
  // MetadataDialog.js - 修复handleApply函数的逻辑
const handleApply = () => {
  // 如果没有任何参数被选中，则提示用户
  if (Object.values(paramStatus).every(value => !value)) {
    alert(t('painting.tools.metadata.selectAtLeastOne'));
    return;
  }
  
  // 创建一个经过过滤的元数据对象
  const filteredMetadata = {};
  
  // 一个一个检查参数，只将选中的参数添加到过滤后的对象中
  if (paramStatus.width && metadata.width) filteredMetadata.width = metadata.width;
  if (paramStatus.height && metadata.height) filteredMetadata.height = metadata.height;
  if (paramStatus.steps && metadata.steps) filteredMetadata.steps = metadata.steps;
  if (paramStatus.guidanceScale && metadata.guidanceScale) filteredMetadata.guidanceScale = metadata.guidanceScale;
  if (paramStatus.seed && metadata.seed !== undefined) filteredMetadata.seed = metadata.seed;
  if (paramStatus.sampler && metadata.sampler) filteredMetadata.sampler = metadata.sampler;
  if (paramStatus.noiseSchedule && metadata.noiseSchedule) filteredMetadata.noiseSchedule = metadata.noiseSchedule;
  
  // 高级参数
  if (paramStatus.smea && metadata.smea !== undefined) filteredMetadata.smea = metadata.smea;
  if (paramStatus.dyn && metadata.dyn !== undefined) filteredMetadata.dyn = metadata.dyn;
  if (paramStatus.promptGuidanceRescale && metadata.promptGuidanceRescale !== undefined) 
    filteredMetadata.promptGuidanceRescale = metadata.promptGuidanceRescale;
  
  // 提示词
  if (paramStatus.positivePrompt && metadata.positivePrompt) 
    filteredMetadata.positivePrompt = metadata.positivePrompt;
  if (paramStatus.negativePrompt && metadata.negativePrompt) 
    filteredMetadata.negativePrompt = metadata.negativePrompt;
  
  // 角色信息
  if (paramStatus.characterTabs && metadata.characterTabs && metadata.characterTabs.length > 0) {
    // 只保留被选中的角色
    filteredMetadata.characterTabs = metadata.characterTabs.filter((_, index) => 
      paramStatus[`character_${index}`]
    );
    
    // 如果没有选中任何角色，则不传递characterTabs属性
    if (filteredMetadata.characterTabs.length === 0) {
      delete filteredMetadata.characterTabs;
    }
  }
  
  // 调用原始的onApply函数，传入过滤后的元数据
  onApply(filteredMetadata);
};

  // 获取角色的位置描述
  const getPositionDescription = (position) => {
    if (!position) return t('painting.tools.metadata.unknownPosition');
    const supportedPositions = new Set([
      'A1', 'B1', 'C1', 'D1', 'E1', 'A2', 'B2', 'C2', 'D2', 'E2',
      'A3', 'B3', 'C3', 'D3', 'E3', 'A4', 'B4', 'C4', 'D4', 'E4',
      'A5', 'B5', 'C5', 'D5', 'E5',
    ]);
    return supportedPositions.has(position)
      ? t(`painting.tools.metadata.positions.${position}`)
      : position;
  };
  
  // 渲染参数行，带有点击切换功能
  const renderParamRow = (name, value, paramKey) => {
    return (
      <TableRow 
        onClick={() => toggleParam(paramKey)}
        sx={{ 
          cursor: 'pointer',
          opacity: paramStatus[paramKey] ? 1 : 0.5,
          '&:hover': { backgroundColor: 'action.hover' }
        }}
      >
        <TableCell component="th" scope="row" sx={{ width: '30%' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {name}
            {paramStatus[paramKey] ? 
              <CheckCircleIcon fontSize="small" color="success" sx={{ ml: 1 }} /> : 
              <CancelIcon fontSize="small" color="disabled" sx={{ ml: 1 }} />
            }
          </Box>
        </TableCell>
        <TableCell>{value}</TableCell>
      </TableRow>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="metadata-dialog-title"
      scroll="paper" // 确保对话框可以滚动
    >
      <DialogTitle id="metadata-dialog-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <InfoOutlined sx={{ mr: 1, color: 'info.main' }} />
          <Typography variant="h6">{t('painting.tools.metadata.title')}</Typography>
        </Box>
        
        <FormControlLabel
          control={<Switch checked={isAllSelected} onChange={toggleSelectAll} />}
          label={t('painting.tools.metadata.selectAll')}
        />
      </DialogTitle>
      
      <DialogContent dividers sx={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('painting.tools.metadata.description')}
          </Typography>
        </Box>
        
        {/* 基础参数部分 */}
        <Paper 
          variant="outlined" 
          sx={{ 
            p: 2, 
            backgroundColor: 'background.paper', 
            mb: 2
          }}
        >
          <Typography variant="subtitle1" color="primary" fontWeight="medium" sx={{ mb: 2 }}>
            {t('painting.tools.metadata.basicParameters')}
          </Typography>
          
          <TableContainer component={Box}>
            <Table size="small">
              <TableBody>
                {metadata.width && metadata.height && 
                  renderParamRow(t('painting.tools.metadata.size'), `${metadata.width} × ${metadata.height}`, 'width')}
                
                {metadata.steps && 
                  renderParamRow(t('painting.tools.metadata.steps'), metadata.steps, 'steps')}
                
                {metadata.guidanceScale && 
                  renderParamRow(t('painting.tools.metadata.guidanceScale'), metadata.guidanceScale, 'guidanceScale')}
                
                {metadata.seed !== undefined && 
                  renderParamRow(t('painting.tools.metadata.seed'), metadata.seed, 'seed')}
                
                {metadata.sampler && 
                  renderParamRow(t('painting.tools.metadata.sampler'), getModelName(metadata.sampler), 'sampler')}
                
                {metadata.noiseSchedule && 
                  renderParamRow(t('painting.tools.metadata.noiseSchedule'), metadata.noiseSchedule, 'noiseSchedule')}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
        
        {/* 高级参数部分 */}
        {(metadata.smea !== undefined || metadata.dyn !== undefined || metadata.promptGuidanceRescale !== undefined) && (
          <Paper 
            variant="outlined" 
            sx={{ 
              p: 2, 
              backgroundColor: 'background.paper', 
              mb: 2
            }}
          >
            <Typography variant="subtitle1" color="primary" fontWeight="medium" sx={{ mb: 2 }}>
              {t('painting.tools.metadata.advancedParameters')}
            </Typography>
            
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {metadata.smea !== undefined && (
                <Chip 
                  label={`${t('painting.tools.metadata.smea')}: ${metadata.smea ? t('painting.tools.common.on') : t('painting.tools.common.off')}`}
                  color={metadata.smea ? 'primary' : 'default'}
                  variant={paramStatus.smea ? 'filled' : 'outlined'}
                  size="small"
                  onClick={() => toggleParam('smea')}
                  sx={{ 
                    opacity: paramStatus.smea ? 1 : 0.5,
                    cursor: 'pointer'
                  }}
                />
              )}
              
              {metadata.dyn !== undefined && (
                <Chip 
                  label={`${t('painting.tools.metadata.dyn')}: ${metadata.dyn ? t('painting.tools.common.on') : t('painting.tools.common.off')}`}
                  color={metadata.dyn ? 'primary' : 'default'}
                  variant={paramStatus.dyn ? 'filled' : 'outlined'}
                  size="small"
                  onClick={() => toggleParam('dyn')}
                  sx={{ 
                    opacity: paramStatus.dyn ? 1 : 0.5,
                    cursor: 'pointer'
                  }}
                />
              )}
              
              {metadata.promptGuidanceRescale !== undefined && (
                <Chip 
                  label={`${t('painting.tools.metadata.promptGuidanceRescale')}: ${metadata.promptGuidanceRescale}`}
                  color="primary"
                  variant={paramStatus.promptGuidanceRescale ? 'filled' : 'outlined'}
                  size="small"
                  onClick={() => toggleParam('promptGuidanceRescale')}
                  sx={{ 
                    opacity: paramStatus.promptGuidanceRescale ? 1 : 0.5,
                    cursor: 'pointer'
                  }}
                />
              )}
            </Box>
          </Paper>
        )}
        
        {/* 提示词部分 */}
        <Paper 
          variant="outlined" 
          sx={{ 
            p: 2, 
            backgroundColor: 'background.paper', 
            mb: 2
          }}
        >
          <Typography variant="subtitle1" color="primary" fontWeight="medium" sx={{ mb: 2 }}>
            {t('painting.tools.metadata.prompts')}
          </Typography>
          
          <Box>
            <Paper 
              variant="outlined" 
              sx={{ 
                p: 2, 
                mb: 2, 
                bgcolor: 'background.paper',
                opacity: paramStatus.positivePrompt ? 1 : 0.5,
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' }
              }}
              onClick={() => toggleParam('positivePrompt')}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('painting.tools.notebook.positivePrompt')}:
                </Typography>
                {paramStatus.positivePrompt ? 
                  <CheckCircleIcon fontSize="small" color="success" sx={{ ml: 1 }} /> : 
                  <CancelIcon fontSize="small" color="disabled" sx={{ ml: 1 }} />
                }
              </Box>
              <Typography 
                variant="body2" 
                sx={{ 
                  p: 1, 
                  backgroundColor: 'rgba(0, 0, 0, 0.03)', 
                  borderRadius: 1,
                  maxHeight: '100px',
                  overflow: 'auto'
                }}
              >
                {renderPrompt(metadata.positivePrompt, 2000)}
              </Typography>
            </Paper>
            
            <Paper 
              variant="outlined" 
              sx={{ 
                p: 2, 
                bgcolor: 'background.paper',
                opacity: paramStatus.negativePrompt ? 1 : 0.5,
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' }
              }}
              onClick={() => toggleParam('negativePrompt')}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('painting.tools.notebook.negativePrompt')}:
                </Typography>
                {paramStatus.negativePrompt ? 
                  <CheckCircleIcon fontSize="small" color="success" sx={{ ml: 1 }} /> : 
                  <CancelIcon fontSize="small" color="disabled" sx={{ ml: 1 }} />
                }
              </Box>
              <Typography 
                variant="body2" 
                sx={{ 
                  p: 1, 
                  backgroundColor: 'rgba(0, 0, 0, 0.03)', 
                  borderRadius: 1,
                  maxHeight: '100px',
                  overflow: 'auto'
                }}
              >
                {renderPrompt(metadata.negativePrompt, 2000)}
              </Typography>
            </Paper>
          </Box>
        </Paper>
        
        {/* 角色信息部分 */}
        {metadata.characterTabs && metadata.characterTabs.length > 0 && (
          <Paper 
            variant="outlined" 
            sx={{ 
              p: 2, 
              backgroundColor: 'background.paper'
            }}
          >
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center',
              mb: 2
            }}>
              <Typography variant="subtitle1" color="primary" fontWeight="medium" sx={{ mr: 1 }}>
                {t('painting.tools.metadata.characterInfo')}
              </Typography>
              <FormControlLabel
                control={
                  <Switch 
                    checked={paramStatus.characterTabs} 
                    onChange={() => toggleParam('characterTabs')}
                    color="primary"
                    size="small"
                  />
                }
                label={t('painting.tools.metadata.applyAllCharacters')}
              />
            </Box>
            
            <Box sx={{ opacity: paramStatus.characterTabs ? 1 : 0.5 }}>
              <List sx={{ width: '100%', p: 0 }}>
                {metadata.characterTabs.map((char, index) => (
                  <Accordion 
                    key={index} 
                    sx={{ 
                      mb: 1, 
                      '&:last-child': { mb: 0 },
                      opacity: paramStatus[`character_${index}`] ? 1 : 0.6
                    }}
                    disabled={!paramStatus.characterTabs}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      aria-controls={`character-content-${index}`}
                      id={`character-header-${index}`}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <ListItemAvatar sx={{ minWidth: 40 }}>
                          <Avatar 
                            sx={{ 
                              width: 32, 
                              height: 32, 
                              bgcolor: `hsl(${index * 60}, 80%, 70%)` 
                            }}
                          >
                            <PersonIcon />
                          </Avatar>
                        </ListItemAvatar>
                        
                        <ListItemText 
                          primary={
                            <Typography variant="subtitle2" noWrap sx={{ maxWidth: 250 }}>
                              {char.prompt ? 
                                (char.prompt.length > 30 ? char.prompt.substring(0, 30) + '...' : char.prompt) 
                                : t('painting.tools.metadata.unnamedCharacter')
                              }
                            </Typography>
                          } 
                          secondary={
                            <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                              <PlaceIcon sx={{ fontSize: 16, mr: 0.5, color: 'text.secondary' }} />
                              <Typography variant="caption" color="text.secondary">
                                {getPositionDescription(char.position) || t('painting.tools.metadata.positionNotSet')}
                              </Typography>
                            </Box>
                          }
                        />
                        
                        <Switch
                          checked={paramStatus[`character_${index}`]}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleParam(`character_${index}`);
                          }}
                          size="small"
                          disabled={!paramStatus.characterTabs}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0 }}>
                      <Divider sx={{ mb: 2 }} />
                      
                      <Typography variant="caption" color="text.secondary" gutterBottom>
                        {t('painting.tools.metadata.characterDescription')}:
                      </Typography>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          mt: 0.5, 
                          p: 1, 
                          backgroundColor: 'rgba(0, 0, 0, 0.03)', 
                          borderRadius: 1,
                          mb: 2,
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {char.prompt || t('painting.tools.metadata.noDescription')}
                      </Typography>
                      
                      <Typography variant="caption" color="text.secondary" gutterBottom>
                        {t('painting.tools.metadata.characterNegative')}:
                      </Typography>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          mt: 0.5, 
                          p: 1, 
                          backgroundColor: 'rgba(0, 0, 0, 0.03)', 
                          borderRadius: 1,
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {char.uc || t('painting.tools.metadata.noNegativeContent')}
                      </Typography>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </List>
            </Box>
          </Paper>
        )}
      </DialogContent>
      
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">{t('painting.tools.common.cancel')}</Button>
        <Button 
          onClick={handleApply} 
          color="primary" 
          variant="contained"
          autoFocus
          disabled={Object.values(paramStatus).every(value => !value)}
        >
          {t('painting.tools.metadata.applySelected')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MetadataDialog;
